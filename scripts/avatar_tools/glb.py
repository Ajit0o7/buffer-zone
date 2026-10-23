"""Minimal glTF 2.0 binary (GLB) reader and writer, enough to edit avatars with numpy.

The whole binary chunk is kept as one bytearray; new data is appended to it, one buffer view per
accessor or image. Unused old data isn't compacted (the files are rewritten by gltf-transform later).
"""
import io
import json
import struct

import numpy as np

COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
COMPONENT_ID = {np.dtype(v): k for k, v in COMPONENT.items()}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
TYPE_FOR = {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4'}


class GLB:
    def __init__(self, path):
        data = open(path, 'rb').read()
        assert data[:4] == b'glTF', f'{path} is not a GLB file'
        offset = 12
        self.json = None
        self.bin = bytearray()
        while offset < len(data):
            length, kind = struct.unpack('<II', data[offset:offset + 8])
            chunk = data[offset + 8:offset + 8 + length]
            if kind == 0x4E4F534A:
                self.json = json.loads(chunk)
            elif kind == 0x004E4942:
                self.bin = bytearray(chunk)
            offset += 8 + length
        j = self.json
        for key in ('accessors', 'bufferViews', 'images', 'textures', 'samplers', 'materials', 'meshes', 'nodes'):
            j.setdefault(key, [])
        j['buffers'] = [{'byteLength': len(self.bin)}]

    # ---- reading -------------------------------------------------------------------------------
    def read(self, accessor_index):
        """Accessor data as a numpy array of shape (count, width), de-normalised if needed."""
        a = self.json['accessors'][accessor_index]
        view = self.json['bufferViews'][a['bufferView']]
        dtype = np.dtype(COMPONENT[a['componentType']])
        width = WIDTH[a['type']]
        start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = view.get('byteStride', 0) or dtype.itemsize * width
        raw = np.frombuffer(self.bin, dtype=np.uint8, count=stride * (a['count'] - 1) + dtype.itemsize * width, offset=start)
        out = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], dtype.itemsize * width), strides=(stride, 1))
        out = np.array(out).view(dtype).reshape(a['count'], width)  # a copy: the buffer may grow later
        if a.get('normalized'):
            out = out.astype(np.float32) / np.iinfo(dtype).max
        return out

    # ---- writing -------------------------------------------------------------------------------
    def _append(self, payload, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        view = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(payload)}
        if target:
            view['target'] = target
        self.bin.extend(payload)
        self.json['bufferViews'].append(view)
        self.json['buffers'][0]['byteLength'] = len(self.bin)
        return len(self.json['bufferViews']) - 1

    def add_accessor(self, array, target=None, normalized=False):
        array = np.ascontiguousarray(array)
        if array.ndim == 1:
            array = array.reshape(-1, 1)
        view = self._append(array.tobytes(), target)
        accessor = {
            'bufferView': view,
            'componentType': COMPONENT_ID[array.dtype],
            'count': int(array.shape[0]),
            'type': TYPE_FOR[array.shape[1]],
        }
        if normalized:
            accessor['normalized'] = True
        if array.dtype == np.float32 and array.shape[1] <= 4:
            accessor['min'] = array.min(axis=0).tolist()
            accessor['max'] = array.max(axis=0).tolist()
        self.json['accessors'].append(accessor)
        return len(self.json['accessors']) - 1

    def add_image(self, pil_image, name, fmt='JPEG', quality=90):
        buf = io.BytesIO()
        if fmt == 'JPEG':
            pil_image.convert('RGB').save(buf, 'JPEG', quality=quality, optimize=True)
            mime = 'image/jpeg'
        else:
            pil_image.save(buf, 'PNG', optimize=True)
            mime = 'image/png'
        view = self._append(buf.getvalue())
        self.json['images'].append({'name': name, 'mimeType': mime, 'bufferView': view})
        return len(self.json['images']) - 1

    def add_texture(self, image_index):
        if not self.json['samplers']:
            self.json['samplers'].append({'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497})
        self.json['textures'].append({'sampler': 0, 'source': image_index})
        return len(self.json['textures']) - 1

    def save(self, path):
        j = self.json
        # Drop images and textures nothing references any more (the converter's empty placeholders).
        used_tex = set()
        for m in j['materials']:
            for slot in (m.get('pbrMetallicRoughness', {}).get('baseColorTexture'), m.get('normalTexture'),
                         m.get('pbrMetallicRoughness', {}).get('metallicRoughnessTexture')):
                if slot:
                    used_tex.add(slot['index'])
        tex_map, textures, image_map, images = {}, [], {}, []
        for i in sorted(used_tex):
            t = dict(j['textures'][i])
            src = t['source']
            if src not in image_map:
                image_map[src] = len(images)
                images.append(j['images'][src])
            t['source'] = image_map[src]
            tex_map[i] = len(textures)
            textures.append(t)
        for m in j['materials']:
            for holder, key in ((m.get('pbrMetallicRoughness', {}), 'baseColorTexture'), (m, 'normalTexture'),
                                (m.get('pbrMetallicRoughness', {}), 'metallicRoughnessTexture')):
                if holder.get(key):
                    holder[key]['index'] = tex_map[holder[key]['index']]
        j['textures'], j['images'] = textures, images
        while len(self.bin) % 4:
            self.bin.append(0)
        j['buffers'] = [{'byteLength': len(self.bin)}]
        text = json.dumps(j, separators=(',', ':')).encode()
        text += b' ' * ((4 - len(text) % 4) % 4)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(text) + 8 + len(self.bin)))
            f.write(struct.pack('<II', len(text), 0x4E4F534A) + text)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin))
