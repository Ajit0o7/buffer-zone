"""Rocketbox (3ds Max Biped) rigs: textures, Mixamo bone names, and the bind pose of each vertex."""
import numpy as np
from PIL import Image

# Biped bone name -> Mixamo bone name (without the "mixamorig" prefix), so the game's retargeting,
# head-look and facing code find the bones they expect.
FINGERS = {'0': 'Thumb', '1': 'Index', '2': 'Middle', '3': 'Ring', '4': 'Pinky'}


def mixamo_name(biped):
    if not biped.startswith('Bip01 '):
        return None
    rest = biped[len('Bip01 '):]
    simple = {'Pelvis': 'Hips', 'Spine': 'Spine', 'Spine1': 'Spine1', 'Spine2': 'Spine2', 'Neck': 'Neck', 'Head': 'Head'}
    if rest in simple:
        return simple[rest]
    if rest[:2] in ('L ', 'R '):
        side = 'Left' if rest[0] == 'L' else 'Right'
        part = rest[2:]
        limbs = {'Clavicle': 'Shoulder', 'UpperArm': 'Arm', 'Forearm': 'ForeArm', 'Hand': 'Hand',
                 'Thigh': 'UpLeg', 'Calf': 'Leg', 'Foot': 'Foot', 'Toe0': 'ToeBase'}
        if part in limbs:
            return side + limbs[part]
        if part.startswith('Finger'):
            digits = part[len('Finger'):]  # "0", "01", "02" -> thumb segments 1, 2, 3
            finger = FINGERS.get(digits[0])
            if finger:
                return f'{side}Hand{finger}{1 + int(digits[1]) if len(digits) > 1 else 1}'
    return None  # face bones keep their Biped names


def rename_bones(glb):
    renamed = 0
    for node in glb.json['nodes']:
        new = mixamo_name(node.get('name', ''))
        if new:
            node['name'] = new
            renamed += 1
    return renamed


def load_texture(path, size):
    im = Image.open(path)
    if size and im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    return im


def skin_joint_names(glb):
    skin = glb.json['skins'][0]
    return [glb.json['nodes'][i]['name'] for i in skin['joints']]
