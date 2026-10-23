#!/usr/bin/env python3
"""Builds the two Nepali-dressed avatars, client/public/models/avatars/boy.glb and girl.glb.

Source: Microsoft Rocketbox (MIT licence), realistic rigged humans:
  boy   Male_Adult_10   -> daura suruwal (cream), dark waistcoat, Dhaka topi, black shoes
  girl  Female_Adult_01 -> kurtha surwal (maroon kurtha with a gold print, cream surwal), golden dupatta,
                           dark hair

What it does, per avatar:
  1. downloads the FBX and its textures (pinned to one Rocketbox commit) into scripts/.avatar-cache/
  2. converts FBX -> GLB with FBX2glTF (installed into the cache from npm on first run)
  3. renames the Biped bones to Mixamo names, so the game's retargeting and head-look find them
  4. repaints the clothes in 3D: every texel of the body texture is mapped back to the point on the
     body it covers, so garments are painted by body region, keeping the original folds and shading
  5. adds skinned garment geometry: the knee-length skirt of the daura or kurtha, the Dhaka topi,
     the dupatta
  6. attaches colour and normal textures, and writes the GLB

Requires Python 3.9+ with numpy and Pillow, Node.js (for FBX2glTF), and network access.
The built files are committed, so you only need this to change the outfits.

Usage:  python3 scripts/dress-avatars.py [boy|girl ...]
"""
import math
import platform
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'avatar_tools'))
from garments import (dhaka_pattern, dupatta, dhaka_topi, floral_print, lower_panel, pallu, plain_cloth,  # noqa: E402
                      press_hair, skin_attributes, transfer_weights, weave, blur, SURFACE)
from glb import GLB  # noqa: E402
from paint import dilate, luminance, position_map  # noqa: E402
from rig import load_texture, rename_bones, skin_joint_names  # noqa: E402

ROOT = HERE.parent
CACHE = HERE / '.avatar-cache'
OUT = ROOT / 'client' / 'public' / 'models' / 'avatars'
ROCKETBOX = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/0943055db6ec570bcef9f2c8b41c9e5467c808f9'
TEX = 2048  # body and head colour maps
NORMAL_TEX = 1024

# Motion-capture clips from the same library, recorded on the same Biped skeleton, so they play on
# the avatars directly. (folder, file): 'static' clips stand in place; 'xy' clips travel, and the build
# measures their speed from that travel, then removes it so they play in place.
MOTION = {
    'm': {'idle': ('static', 'm_idle_neutral_01'), 'walk': ('xy', 'm_walk_fast_02'), 'run': ('xy', 'm_run_fast_01')},
    'f': {'idle': ('static', 'f_idle_neutral_01'), 'walk': ('xy', 'f_walk_fast_02'), 'run': ('xy', 'f_run_fast_01')},
}

AVATARS = {
    'boy': {'source': 'Male_Adult_10', 'code': 'm024', 'outfit': 'daura', 'motion': 'm'},
    'girl': {'source': 'Female_Adult_01', 'code': 'f001', 'outfit': 'sari', 'motion': 'f'},
}

# Colours (linear-ish 0..1 sRGB values; the textures are sRGB).
DAURA = (0.90, 0.87, 0.79)  # unbleached cotton
WAISTCOAT = (0.075, 0.075, 0.085)
BUTTON = (0.78, 0.62, 0.30)
SHOE = (0.055, 0.045, 0.04)
KURTHA = (0.50, 0.05, 0.09)  # deep maroon
KURTHA_PRINT = (0.86, 0.66, 0.24)  # gold
GOLD_TRIM = (0.88, 0.70, 0.30)
SURWAL = (0.93, 0.86, 0.68)
DUPATTA = (0.90, 0.52, 0.10)  # marigold
HAIR = (0.045, 0.032, 0.026)
SARI = (0.64, 0.04, 0.08)  # festive red silk
SARI_MOTIF = (0.90, 0.72, 0.30)  # gold
BLOUSE = (0.36, 0.03, 0.07)  # maroon cholo


# ---- sources ---------------------------------------------------------------------------------

def fetch(url, dest):
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f'  downloading {url.rsplit("/", 1)[-1]}')
    tmp = dest.with_suffix(dest.suffix + '.part')
    with urllib.request.urlopen(url) as r, open(tmp, 'wb') as f:
        f.write(r.read())
    tmp.rename(dest)
    return dest


def fbx2gltf():
    tools = CACHE / 'tools'
    folder = {'Darwin': 'Darwin', 'Windows': 'Windows_NT'}.get(platform.system(), 'Linux')
    exe = tools / 'node_modules' / 'fbx2gltf' / 'bin' / folder / ('FBX2glTF.exe' if folder == 'Windows_NT' else 'FBX2glTF')
    if not exe.exists():
        tools.mkdir(parents=True, exist_ok=True)
        print('  installing FBX2glTF from npm')
        subprocess.run(['npm', 'install', '--prefix', str(tools), '--no-save', 'fbx2gltf@0.9.7-p1'], check=True,
                       shell=platform.system() == 'Windows')
    if folder != 'Windows_NT':
        exe.chmod(0o755)
    return exe


def motion_clip(folder, name):
    """Downloads and converts one Rocketbox animation; returns the converted GLB's path."""
    base = f'{ROCKETBOX}/Assets/Animations/all_animations_max_motextr_{folder}'
    target = CACHE / 'animations' / f'{name}_{folder}'
    fbx = fetch(f'{base}/{name}.max.fbx', target.with_suffix('.fbx'))
    glb = target.with_suffix('.glb')
    if not glb.exists():
        subprocess.run([str(fbx2gltf()), '--binary', '--input', str(fbx), '--output', str(target)], check=True,
                       stdout=subprocess.DEVNULL)
    return glb


def add_motion(g, set_name):
    """Copies idle, walk and run into the avatar as glTF animations named after their state.
    Every bone takes the clip's rotations; only the root (Bip01) takes translation, in place (its
    horizontal travel removed) and scaled to the avatar's hip height, so the avatar keeps its own
    proportions. Returns each clip's natural ground speed in m/s (0 for idle)."""
    nodes = {n.get('name'): i for i, n in enumerate(g.json['nodes'])}
    root_y = g.json['nodes'][nodes['Bip01']]['translation'][1]
    speeds = {}
    g.json.setdefault('animations', [])
    for state, (folder, name) in MOTION[set_name].items():
        src = GLB(motion_clip(folder, name))
        rename_bones(src)
        anim = src.json['animations'][0]
        out = {'name': state, 'channels': [], 'samplers': []}
        speeds[state] = 0.0
        for ch in anim['channels']:
            node_name = src.json['nodes'][ch['target']['node']].get('name')
            path = ch['target']['path']
            if node_name not in nodes or path == 'scale' or (path == 'translation' and node_name != 'Bip01'):
                continue
            sampler = anim['samplers'][ch['sampler']]
            times = src.read(sampler['input']).astype(np.float32)
            values = src.read(sampler['output']).astype(np.float32)
            if path == 'translation':
                if folder == 'xy':
                    travel = np.linalg.norm(values[-1, [0, 2]] - values[0, [0, 2]])
                    speeds[state] = float(travel / max(times[-1, 0], 1e-3))
                src_y = src.json['nodes'][ch['target']['node']]['translation'][1]
                values = values.copy()
                values[:, 0] = 0
                values[:, 2] = 0
                values[:, 1] *= root_y / src_y
            out['samplers'].append({'input': g.add_accessor(times), 'output': g.add_accessor(values),
                                    'interpolation': sampler.get('interpolation', 'LINEAR')})
            out['channels'].append({'sampler': len(out['samplers']) - 1, 'target': {'node': nodes[node_name], 'path': path}})
        g.json['animations'].append(out)
    return speeds


def source_files(spec):
    name, code = spec['source'], spec['code']
    base = f'{ROCKETBOX}/Assets/Avatars/Adults/{name}'
    folder = CACHE / name
    fbx = fetch(f'{base}/Export/{name}.fbx', folder / f'{name}.fbx')
    textures = {}
    for part in ('body_color', 'body_normal', 'head_color', 'head_normal', 'opacity_color'):
        textures[part] = fetch(f'{base}/Textures/{code}_{part}.tga', folder / f'{code}_{part}.tga')
    glb = folder / f'{name}.glb'
    if not glb.exists():
        subprocess.run([str(fbx2gltf()), '--binary', '--input', str(fbx), '--output', str(folder / name)], check=True,
                       stdout=subprocess.DEVNULL)
    return glb, textures


# ---- helpers ---------------------------------------------------------------------------------

def bind_positions(g):
    """Bone name -> bind-pose position (mesh space), from the inverse bind matrices."""
    skin = g.json['skins'][0]
    ibm = g.read(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    return {g.json['nodes'][j]['name']: np.linalg.inv(m)[:3, 3] for j, m in zip(skin['joints'], ibm)}


def primitive(g, suffix):
    for prim in g.json['meshes'][0]['primitives']:
        if g.json['materials'][prim['material']]['name'].endswith(suffix):
            return prim
    raise KeyError(suffix)


def geometry(g, prim):
    return (g.read(prim['attributes']['POSITION']), g.read(prim['attributes']['TEXCOORD_0']),
            g.read(prim['indices']).reshape(-1, 3))


def nearest_segment(points, segments):
    """Labels each point with the name of the nearest bone segment (a, b)."""
    flat = points.reshape(-1, 3)
    best = np.full(len(flat), np.inf)
    label = np.empty(len(flat), object)
    for name, (a, b) in segments.items():
        ab = b - a
        t = np.clip(((flat - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
        d = np.linalg.norm(flat - (a + t[:, None] * ab), axis=1)
        closer = d < best
        best[closer] = d[closer]
        label[closer] = name
    return label.reshape(points.shape[:-1])


def body_segments(b):
    seg = {
        'torso': (b['Hips'], b['Neck']),
        'head': (b['Neck'], b['Head'] + np.array([0, 0, 0.15])),
    }
    for side in ('Left', 'Right'):
        seg[f'{side}UpperArm'] = (b[f'{side}Arm'], b[f'{side}ForeArm'])
        seg[f'{side}ForeArm'] = (b[f'{side}ForeArm'], b[f'{side}Hand'])
        seg[f'{side}Hand'] = (b[f'{side}Hand'], b[f'{side}Hand'] + (b[f'{side}Hand'] - b[f'{side}ForeArm']) * 0.5)
        seg[f'{side}Thigh'] = (b[f'{side}UpLeg'], b[f'{side}Leg'])
        seg[f'{side}Shin'] = (b[f'{side}Leg'], b[f'{side}Foot'])
        seg[f'{side}Foot'] = (b[f'{side}Foot'], b[f'{side}ToeBase'] if f'{side}ToeBase' in b else b[f'{side}Foot'])
    return seg


def is_skin(rgb):
    r, gch, bch = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (r > gch) & (gch > bch) & (gch - bch > 0.04) & (r - bch > 0.15) & (luminance(rgb) > 0.22)


def smooth_shading(rgb, region, radius=3):
    """Brightness of the original fabric, blurred, so stripes, zips and denim fades don't print through."""
    lum = luminance(rgb)
    ref = np.median(lum[region]) if region.any() else 1
    shade = np.where(region, lum / max(ref, 1e-3), 0).astype(np.float32)
    shade = np.clip(shade, 0.45, 1.35)
    weight = blur(region.astype(np.float32), radius)
    shade = blur(np.where(region, shade, 0).astype(np.float32), radius) / np.maximum(weight, 1e-3)
    return np.where(region, shade, 1)


def paint(rgb, region, colour, shade, cloth=None):
    """Sets region to colour (RGB or HxWx3), scaled by shade and a woven-cloth texture."""
    colour = np.asarray(colour, np.float32)
    c = colour[region] if colour.ndim == 3 else colour[None, :]
    k = shade[region][:, None]
    if cloth is not None:
        k = k * cloth[region][:, None]
    rgb[region] = np.clip(c * k, 0, 1)


def add_primitive(g, mesh_index, part, joint_names, material):
    joints, weights = skin_attributes(part['weights'], joint_names)
    attrs = {
        'POSITION': g.add_accessor(part['positions'].astype(np.float32), 34962),
        'NORMAL': g.add_accessor(part['normals'].astype(np.float32), 34962),
        'TEXCOORD_0': g.add_accessor(part['uvs'].astype(np.float32), 34962),
        'JOINTS_0': g.add_accessor(joints, 34962),
        'WEIGHTS_0': g.add_accessor(weights, 34962),
    }
    indices = g.add_accessor(part['triangles'].reshape(-1).astype(np.uint32), 34963)
    g.json['meshes'][mesh_index]['primitives'].append({'attributes': attrs, 'indices': indices, 'material': material})


def add_material(g, name, image, roughness, double_sided=True, fmt='JPEG'):
    tex = g.add_texture(g.add_image(Image.fromarray((np.clip(image, 0, 1) * 255).astype(np.uint8)), name, fmt, 90))
    g.json['materials'].append({
        'name': name,
        'pbrMetallicRoughness': {'baseColorTexture': {'index': tex}, 'metallicFactor': 0, 'roughnessFactor': roughness},
        'doubleSided': double_sided,
    })
    return len(g.json['materials']) - 1


# ---- outfits ---------------------------------------------------------------------------------

def VEST_BOTTOM(b):
    return b['Hips'][2] + 0.01  # the waistcoat ends at the hips, where the daura's skirt takes over


def paint_collar(head_rgb, g, head_prim, b, colour):
    """The head mesh carries the neck and the original collar: repaint the collar."""
    hpos, huv, htris = geometry(g, head_prim)
    hpts, hmask = position_map(huv, hpos, htris, head_rgb.shape[0])
    collar = hmask & ~is_skin(head_rgb) & (hpts[..., 2] < b['Head'][2] - 0.01) & (luminance(head_rgb) > 0.05)
    paint(head_rgb, collar, colour, smooth_shading(head_rgb, collar, 3), weave(head_rgb.shape[0], 0.05))
    return collar


def dress_daura(rgb, pts, mask, labels, b):
    """Cream daura suruwal, a dark waistcoat over it, black shoes."""
    z = pts[..., 2]
    hands = np.isin(labels, ['LeftHand', 'RightHand']) & is_skin(rgb)
    # Shoes: the light trainers around the feet (the dark trouser cuffs above them stay trousers).
    feet = mask & (z < b['LeftFoot'][2] + 0.05) & (luminance(rgb) > 0.22)
    feet |= mask & (z < b['LeftFoot'][2] - 0.06)  # soles
    cloth = mask & ~hands & ~feet & ~((labels == 'head') & is_skin(rgb))  # the collar counts as cloth
    shade = smooth_shading(rgb, cloth, 4)
    legs = cloth & np.isin(labels, ['LeftThigh', 'RightThigh', 'LeftShin', 'RightShin'])
    shade[legs] = np.clip(shade[legs], 0.8, 1.12)  # the nylon track trousers' highlights read as satin
    weave_map = weave(rgb.shape[0], 0.06)
    paint(rgb, cloth, DAURA, shade, weave_map)

    # Waistcoat: the torso from the hips to the shoulders, open in a V at the neck, with gold buttons.
    neck_z = b['Neck'][2]
    v_bottom = b['Spine2'][2] - 0.10
    front = pts[..., 1] < b['Spine2'][1]
    x = pts[..., 0]
    v_half = np.clip((z - v_bottom) / max(neck_z - v_bottom, 1e-3), 0, 1) * 0.085
    in_v = front & (z > v_bottom) & (np.abs(x) < v_half)
    body_not_arms = np.isin(labels, ['torso', 'LeftThigh', 'RightThigh'])
    vest = cloth & body_not_arms & (z > VEST_BOTTOM(b)) & (z < neck_z - 0.01) & ~in_v
    paint(rgb, vest, WAISTCOAT, np.clip(shade, 0.7, 1.25), weave(rgb.shape[0], 0.04))
    for k in range(4):
        bz = v_bottom - 0.005 - k * 0.075
        d = np.hypot(x - 0.012, z - bz)
        button = vest & front & (d < 0.009)
        rgb[button] = BUTTON
    # Feet: black leather shoes.
    paint(rgb, feet, SHOE, np.clip(smooth_shading(rgb, feet, 2), 0.75, 1.3))
    return cloth


def dress_kurtha(rgb, pts, mask, labels, b):
    """Maroon kurtha with a gold print and gold trim, cream surwal; her own shoes stay."""
    z = pts[..., 2]
    # Skin shows on the arms, hands, neck and in the open collar; elsewhere skin-coloured texels are a
    # belt or a leather patch, which become kurtha too.
    bare = np.isin(labels, ['LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand', 'head', 'LeftUpperArm', 'RightUpperArm'])
    bare |= (labels == 'torso') & (z > b['Spine2'][2] - 0.08)
    skin = is_skin(rgb) & mask & bare
    hands = np.isin(labels, ['LeftHand', 'RightHand'])
    feet = mask & np.isin(labels, ['LeftFoot', 'RightFoot']) & (luminance(rgb) < 0.16) & (z < b['LeftFoot'][2] + 0.07)
    waist = b['Hips'][2] - 0.12
    kurtha = mask & ~skin & ~hands & (z > waist)
    surwal = mask & ~skin & ~feet & (z <= waist)
    pattern = floral_print(pts, KURTHA, KURTHA_PRINT, scale=0.032)
    shade_k = np.clip(smooth_shading(rgb, kurtha, 2), 0.6, 1.15)
    paint(rgb, kurtha, pattern, shade_k, weave(rgb.shape[0], 0.04))
    paint(rgb, surwal, SURWAL, np.clip(smooth_shading(rgb, surwal, 6), 0.82, 1.08), weave(rgb.shape[0], 0.05))
    # Gold trim where the kurtha meets skin: the neckline and the sleeve ends.
    near_skin = blur(skin.astype(np.float32), 5) > 0.02
    trim = kurtha & near_skin
    paint(rgb, trim, GOLD_TRIM, np.clip(shade_k, 0.8, 1.2))
    return kurtha | surwal


def dress_sari(rgb, pts, mask, labels, b):
    """Under the sari: a maroon cholo (blouse) with elbow-length sleeves and gold edging, and a little
    bare midriff above the sari's waist. Returns (painted, flatten): flatten marks where the original
    clothes' folds should be smoothed out of the normal map (the new bare skin and the hidden legs)."""
    z = pts[..., 2]
    bare = np.isin(labels, ['LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand', 'head', 'LeftUpperArm', 'RightUpperArm'])
    bare |= (labels == 'torso') & (z > b['Spine2'][2] - 0.08)
    skin = is_skin(rgb) & mask & bare
    hands = np.isin(labels, ['LeftHand', 'RightHand'])
    forearm_skin = skin & np.isin(labels, ['LeftForeArm', 'RightForeArm'])
    skin_rgb = np.median(rgb[forearm_skin], axis=0) if forearm_skin.any() else np.array([0.85, 0.66, 0.56])

    blouse_bottom = b['Spine2'][2] - 0.10  # just under the bust
    sari_waist = b['Hips'][2] + 0.05
    cloth = mask & ~skin & ~hands
    arms = np.isin(labels, ['LeftUpperArm', 'RightUpperArm', 'LeftForeArm', 'RightForeArm'])
    midriff = cloth & ~arms & (z < blouse_bottom) & (z > sari_waist - 0.03)
    blouse = cloth & ~midriff & ((z >= blouse_bottom) | arms)
    below = cloth & ~arms & (z <= sari_waist - 0.03)
    shade = np.clip(smooth_shading(rgb, blouse, 2), 0.65, 1.15)
    paint(rgb, blouse, BLOUSE, shade, weave(rgb.shape[0], 0.04))
    new_skin = midriff
    paint(rgb, new_skin, skin_rgb, np.clip(smooth_shading(rgb, new_skin, 8), 0.9, 1.06))
    paint(rgb, below, SARI, np.clip(smooth_shading(rgb, below, 6), 0.8, 1.1))
    # Gold edging where the blouse meets skin: neckline, sleeve hems, the hem above the midriff.
    edge = blouse & (blur((skin | new_skin).astype(np.float32), 5) > 0.02)
    paint(rgb, edge, GOLD_TRIM, np.clip(shade, 0.8, 1.2))
    return blouse | new_skin | below, new_skin | below


def darken_hair(rgb, region):
    lum = luminance(rgb)
    ref = np.median(lum[region]) if region.any() else 1
    shade = np.clip(lum / max(ref, 1e-3), 0.3, 2.2) ** 0.8
    rgb[region] = np.clip(np.asarray(HAIR)[None, :] * shade[region][:, None] * 1.6, 0, 1)


# ---- build -----------------------------------------------------------------------------------

def build(key):
    spec = AVATARS[key]
    print(f'{key}: {spec["source"]} ({spec["outfit"]})')
    src, tex = source_files(spec)
    g = GLB(src)
    rename_bones(g)
    names = skin_joint_names(g)
    b = bind_positions(g)
    mesh_index = 0
    for prim in g.json['meshes'][mesh_index]['primitives']:
        prim['attributes'].pop('COLOR_0', None)  # the converter's vertex colours would tint everything

    body_prim = primitive(g, '_body')
    body_pos, body_uv, body_tris = geometry(g, body_prim)
    SURFACE['triangles'] = body_pos[body_tris]  # exact surface for draping garments
    head_prim = primitive(g, '_head')
    head_pos = g.read(head_prim['attributes']['POSITION'])
    opacity_prim = primitive(g, '_opacity')
    opacity_pos = g.read(opacity_prim['attributes']['POSITION'])

    # 1. Body texture, repainted in 3D.
    body_rgb = np.asarray(load_texture(tex['body_color'], TEX).convert('RGB'), np.float32) / 255
    pts, mask = position_map(body_uv, body_pos, body_tris, TEX)
    labels = nearest_segment(pts, body_segments(b))
    if spec['outfit'] == 'daura':
        painted = dress_daura(body_rgb, pts, mask, labels, b)
        flatten = np.zeros_like(mask)
    elif spec['outfit'] == 'sari':
        painted, flatten = dress_sari(body_rgb, pts, mask, labels, b)
    else:
        painted = dress_kurtha(body_rgb, pts, mask, labels, b)
        # The jeans' normal map embosses pockets, belt loops and seams: smooth it out under the new clothes.
        flatten = painted & (pts[..., 2] < b['Hips'][2] + 0.06)
    body_rgb, _ = dilate(body_rgb, mask, 3)

    # 2. Head and hair: darker hair for the girl (head texture and the hair cards).
    head_rgb = np.asarray(load_texture(tex['head_color'], TEX).convert('RGB'), np.float32) / 255
    opacity = load_texture(tex['opacity_color'], 1024).convert('RGBA')
    paint_collar(head_rgb, g, head_prim, b, {'daura': DAURA, 'sari': BLOUSE}.get(spec['outfit'], KURTHA))
    if key == 'girl':
        hpos, huv, htris = geometry(g, head_prim)
        hpts, hmask = position_map(huv, hpos, htris, TEX)
        r, gg, bb = head_rgb[..., 0], head_rgb[..., 1], head_rgb[..., 2]
        # Where hair grows: above the brow line, or behind the ears (the back of the head and the
        # ponytail). The face, ears and neck are never touched.
        eye_z = np.mean([b[n][2] for n in b if n.endswith('Eye')]) if any(n.endswith('Eye') for n in b) else b['Head'][2] + 0.1
        hx, hy, hz = hpts[..., 0], hpts[..., 1], hpts[..., 2]
        behind = ((hy > b['Head'][1] + 0.03) & (hz > eye_z - 0.06)) | (hy > b['Head'][1] + 0.09)  # back of the head, ponytail
        zone = (hz > eye_z + 0.045) | behind | ((np.abs(hx) > 0.055) & (hz > eye_z - 0.03) & (hy > b['Head'][1] - 0.01))
        # Her own skin colour, from the cheeks; hair is whatever in the zone is clearly yellower than it.
        cheeks = hmask & (np.abs(hx) > 0.02) & (np.abs(hx) < 0.045) & (np.abs(hz - (eye_z - 0.035)) < 0.012) & (hy < b['Head'][1])
        skin_br = np.median((bb / np.maximum(r, 1e-3))[cheeks]) if cheeks.any() else 0.68
        skin_lum = np.median(luminance(head_rgb)[cheeks]) if cheeks.any() else 0.6
        br = bb / np.maximum(r, 1e-3)
        lum = luminance(head_rgb)
        # Anything in the zone that isn't close to her skin colour: blonde strands and pale highlights alike.
        skin_rgb = np.median(head_rgb[cheeks], axis=0) if cheeks.any() else np.array([0.8, 0.62, 0.52])
        # Compare colour, not brightness, so skin in shadow stays skin; pale highlights are brighter than any skin.
        chroma = head_rgb / np.maximum(lum[..., None], 1e-3)
        skin_chroma = skin_rgb / max(skin_lum, 1e-3)
        far = (np.linalg.norm(chroma - skin_chroma, axis=-1) > 0.12) | (lum > skin_lum * 1.15)
        hair = hmask & zone & (((br < skin_br - 0.04) & (lum > 0.06)) | far)
        hair = blur(hair.astype(np.float32), 2) > 0.4  # tidy the edges
        darken_hair(head_rgb, hair)
        o = np.asarray(opacity, np.float32) / 255
        cards = o[..., 3] > 0.02
        darken_hair(o[..., :3], cards)
        opacity = Image.fromarray((o * 255).astype(np.uint8), 'RGBA')

    # 3. Materials for the original parts.
    for m in g.json['materials']:
        part = m['name'].rsplit('_', 1)[-1]
        pbr = m.setdefault('pbrMetallicRoughness', {})
        pbr.update({'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0})
        if part == 'opacity':
            pbr['baseColorTexture'] = {'index': g.add_texture(g.add_image(opacity, 'hair', 'PNG'))}
            pbr['roughnessFactor'] = 0.6
            m.update({'alphaMode': 'MASK', 'alphaCutoff': 0.35, 'doubleSided': True})
        elif part in ('body', 'head'):
            rgb = body_rgb if part == 'body' else head_rgb
            img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
            pbr['baseColorTexture'] = {'index': g.add_texture(g.add_image(img, part, 'JPEG', 88))}
            normal = load_texture(tex[f'{part}_normal'], NORMAL_TEX).convert('RGB')
            if part == 'body' and flatten.any():
                n = np.asarray(normal, np.float32) / 255
                f = np.asarray(Image.fromarray(flatten.astype(np.uint8) * 255).resize(normal.size, Image.BILINEAR), np.float32)[..., None] / 255
                n = n * (1 - 0.85 * f) + np.array([0.5, 0.5, 1.0]) * 0.85 * f
                normal = Image.fromarray((n * 255).astype(np.uint8))
            m['normalTexture'] = {'index': g.add_texture(g.add_image(normal, f'{part}_normal', 'JPEG', 92))}
            pbr['roughnessFactor'] = 0.5 if part == 'head' else 0.85

    # 4. Garment geometry.
    if spec['outfit'] == 'daura':
        cloth = add_material(g, 'daura', plain_cloth(np.asarray(DAURA) * 0.88, 512, 0.06), 0.9)  # matches the body's baked shading
        panel = lower_panel(body_pos, b, z_top=VEST_BOTTOM(b) - 0.005, z_hem=b['LeftLeg'][2] - 0.04, flare=0.035)
        add_primitive(g, mesh_index, panel, names, cloth)
        topi_mat = add_material(g, 'dhaka', dhaka_pattern(), 0.85)
        topi = dhaka_topi(np.concatenate([head_pos, opacity_pos]), b)
        add_primitive(g, mesh_index, topi, names, topi_mat)
        for prim, pos in ((head_prim, head_pos), (opacity_prim, opacity_pos)):
            prim['attributes']['POSITION'] = g.add_accessor(press_hair(pos, topi['fit']).astype(np.float32), 34962)
    elif spec['outfit'] == 'sari':
        skirt = add_material(g, 'sari', sari_skirt_texture(), 0.5)
        panel = lower_panel(body_pos, b, z_top=b['Hips'][2] + 0.05, z_hem=0.035, flare=0.12, rows=20,
                            pleats=(22, 0.012), to_ankle=True)
        add_primitive(g, mesh_index, panel, names, skirt)
        drape = add_material(g, 'pallu', pallu_texture(), 0.5)
        part = pallu(body_pos, b)
        part['weights'] = transfer_weights(part['positions'], body_pos, g.read(body_prim['attributes']['JOINTS_0']),
                                           g.read(body_prim['attributes']['WEIGHTS_0']), names)
        add_primitive(g, mesh_index, part, names, drape)
    else:
        hem_print = kurtha_panel_texture()
        cloth = add_material(g, 'kurtha', hem_print, 0.85)
        panel = lower_panel(body_pos, b, z_top=b['Hips'][2] + 0.01, z_hem=b['LeftLeg'][2] - 0.03, flare=0.06,
                            slit_from=b['Hips'][2] - 0.20)
        add_primitive(g, mesh_index, panel, names, cloth)
        scarf = add_material(g, 'dupatta', dupatta_texture(), 0.75)
        add_primitive(g, mesh_index, dupatta(body_pos, b), names, scarf)

    speeds = add_motion(g, spec['motion'])
    print(f'  clips: idle, walk ({speeds["walk"]:.2f} m/s), run ({speeds["run"]:.2f} m/s)')
    g.json.setdefault('asset', {})['copyright'] = 'Avatar based on Microsoft Rocketbox (MIT licence, (c) 2020 Microsoft)'
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f'{key}.glb'
    g.save(out)
    print(f'  wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.1f} MB)')


def kurtha_panel_texture(size=512):
    """The kurtha's skirt: the same maroon and gold print as the bodice, with a gold band at the hem.
    UV: u runs around the body (6 repeats), v from the waist (0) to the hem (2)."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    # One tile spans a quarter of the way round (about 0.4 m) and the panel's full height: lay the print
    # out on a matching flat patch so its flowers are the same size as on the bodice.
    # floral_print measures arc length on a 0.16 m radius: 2.4 rad is 12 whole motif cells, so the tile repeats seamlessly.
    phi = x * 2.4 - 1.2
    pts = np.stack([np.sin(phi), -np.cos(phi), -y * 0.42 + 0 * x], -1)
    img = floral_print(pts, KURTHA, KURTHA_PRINT, scale=0.032) * 0.85
    img[y > 0.94] = GOLD_TRIM  # gold band at the hem (v = 1)
    img[(y > 0.91) & (y < 0.925)] = GOLD_TRIM
    return np.clip(img * weave(size, 0.05)[..., None], 0, 1)


def butta(x, y, cell):
    """Small woven gold motifs (buttas) on a staggered grid; returns a boolean mask."""
    row = np.floor(y / cell)
    fx = (x + cell * 0.5 * (row % 2)) % cell - cell / 2
    fy = y % cell - cell / 2
    r = np.hypot(fx, fy)
    th = np.arctan2(fy, fx)
    return (r < cell * (0.13 + 0.07 * np.cos(5 * th))) | (r < cell * 0.05)


def sari_skirt_texture(w=512, h=1024):
    """The sari's skirt: red silk with gold buttas and a broad gold border at the hem.
    UV: u runs around the body (4 repeats), v from the waist (0) to the hem (1)."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.zeros((h, w, 3), np.float32) + SARI
    img[butta(x, y, w / 8)] = SARI_MOTIF
    v = y / h
    border = v > 0.86
    img[border] = GOLD_TRIM
    # A woven band inside the border: red diamonds on gold.
    band = (v > 0.89) & (v < 0.96)
    d = (np.abs((x % 32) - 16) + np.abs(((y - 0.925 * h) % 32) - 16)) < 9
    img[band & d] = SARI
    img[(v > 0.835) & (v < 0.845)] = GOLD_TRIM
    return np.clip(img * weave(max(w, h), 0.03)[:h, :w, None], 0, 1)


def pallu_texture(w=2048, h=256):
    """The pallu: red silk with gold buttas, gold borders along both edges, and the richly woven end
    (u > 0.8) that hangs down the back. u along the length, v across."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.zeros((h, w, 3), np.float32) + SARI
    img[butta(x, y, h / 4)] = SARI_MOTIF
    v = y / h
    u = x / w
    img[(v < 0.1) | (v > 0.9)] = GOLD_TRIM
    img[((v > 0.12) & (v < 0.135)) | ((v > 0.865) & (v < 0.88))] = GOLD_TRIM
    end = u > 0.8
    img[end] = GOLD_TRIM
    stripes = end & (((u * 60) % 1) < 0.35)
    img[stripes] = SARI
    d = end & ((np.abs((x % 48) - 24) + np.abs((y % 48) - 24)) < 10)
    img[d] = SARI_MOTIF * np.array([1.0, 0.9, 0.7])
    img[(u > 0.985)] = GOLD_TRIM  # tasselled edge
    return np.clip(img * weave(w, 0.03)[:h, :w, None], 0, 1)


def dupatta_texture(w=1024, h=128):
    """Marigold chiffon with a woven gold-and-maroon border along both edges. v runs across the width."""
    img = np.zeros((h, w, 3), np.float32) + DUPATTA
    y = np.arange(h)[:, None] / h
    border = (y < 0.12) | (y > 0.88)
    inner = ((y > 0.12) & (y < 0.16)) | ((y > 0.84) & (y < 0.88))
    img[np.broadcast_to(border, (h, w))] = GOLD_TRIM
    img[np.broadcast_to(inner, (h, w))] = KURTHA
    xs = np.arange(w)[None, :]
    dots = (((xs % 32) - 16) ** 2 + ((y * h % 32) - 16) ** 2 < 6) & ~border & ~inner
    img[dots] = (0.98, 0.84, 0.45)
    return np.clip(img * weave(w, 0.05)[:h, :w, None], 0, 1)


if __name__ == '__main__':
    keys = sys.argv[1:] or list(AVATARS)
    for k in keys:
        build(k)
