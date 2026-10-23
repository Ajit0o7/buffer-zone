"""Procedural Nepali garments for Rocketbox avatars: fabric textures, and skinned geometry for the
knee-length lower panel of a daura or kurtha, the Dhaka topi and the dupatta.

All geometry is built in the avatar's mesh space (Rocketbox: +X is the character's left, -Y is the
front, +Z is up, metres) and skinned to the avatar's own bones.
"""
import math

import numpy as np

rng = np.random.default_rng(7)


# ---- fabric textures --------------------------------------------------------------------------

def blur(a, r):
    """Box blur (separable, wrap-around), r in pixels."""
    if r < 1:
        return a
    for axis in (0, 1):
        acc = np.zeros_like(a)
        for k in range(-r, r + 1):
            acc += np.roll(a, k, axis)
        a = acc / (2 * r + 1)
    return a


def weave(size, strength=0.05):
    """Cotton weave: fine crossing threads plus soft slub noise, around 1.0."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    threads = 0.5 * np.sin(x * math.pi / 1.5) * np.sin(y * math.pi / 1.5)
    slub = blur(rng.standard_normal((size, size)).astype(np.float32), 2)
    slub /= np.abs(slub).max() + 1e-6
    return 1 + strength * (0.6 * threads + slub)


def plain_cloth(colour, size=512, strength=0.05):
    return np.clip(np.asarray(colour, np.float32)[None, None, :] * weave(size, strength)[..., None], 0, 1)


DHAKA = {
    'ground': (0.06, 0.05, 0.07),
    'red': (0.72, 0.08, 0.10),
    'orange': (0.93, 0.50, 0.10),
    'white': (0.90, 0.88, 0.82),
    'green': (0.10, 0.42, 0.24),
    'blue': (0.13, 0.24, 0.58),
}


def dhaka_pattern(width=1024, height=256):
    """Dhaka weave: rows of stepped diamonds in red, orange, white, green and blue on a dark ground,
    separated by thin bands, as on a Dhaka topi. Tiles horizontally."""
    img = np.zeros((height, width, 3), np.float32) + DHAKA['ground']
    y, x = np.mgrid[0:height, 0:width]
    rows = [('red', 'white'), ('orange', 'green'), ('white', 'red'), ('blue', 'orange'), ('green', 'white'), ('red', 'orange')]
    band = height // len(rows)
    cell = band  # square motif cells
    for r, (outer, inner) in enumerate(rows):
        top = r * band
        in_band = (y >= top) & (y < top + band)
        cy = top + band / 2
        cx = (np.floor(x / cell) + 0.5) * cell
        # Stepped (woven) diamonds: Manhattan distance quantised to 3-pixel steps.
        d = (np.abs(x - cx) // 3 * 3 + np.abs(y - cy) // 3 * 3)
        img[in_band & (d < band * 0.42)] = DHAKA[outer]
        img[in_band & (d < band * 0.26)] = DHAKA['ground']
        img[in_band & (d < band * 0.14)] = DHAKA[inner]
        # Small triangles between diamonds, and a thin band line.
        between = (np.abs(x - cx - cell / 2) // 3 * 3 + np.abs(y - top) // 3 * 3) < band * 0.18
        img[in_band & between] = DHAKA['white' if outer != 'white' else 'red']
        img[(y >= top) & (y < top + 3)] = DHAKA['orange' if r % 2 else 'red']
    return np.clip(img * weave(max(width, height), 0.08)[:height, :width, None], 0, 1)


def floral_print(points, base, motif, scale=0.045):
    """A small woven floral print, evaluated on the body's own surface (so it continues across
    texture seams): four-petal flowers on a diamond lattice, around the body like a printed kurtha."""
    angle = np.arctan2(points[..., 0], -points[..., 1])
    s = angle * 0.16 / scale  # arc length around the body, in motif cells
    t = points[..., 2] / scale
    # Diamond lattice: every other row offset by half a cell.
    row = np.floor(t)
    fs = s + 0.5 * (row % 2) - np.floor(s + 0.5 * (row % 2)) - 0.5
    ft = t - row - 0.5
    r = np.sqrt(fs ** 2 + ft ** 2)
    theta = np.arctan2(ft, fs)
    petal = r < (0.15 + 0.08 * np.cos(4 * theta))
    centre = r < 0.05
    out = np.empty(points.shape, np.float32)
    out[...] = base
    out[petal] = motif
    out[centre] = base
    return out


# ---- geometry helpers ------------------------------------------------------------------------

def vertex_normals(positions, triangles):
    n = np.zeros_like(positions)
    a, b, c = positions[triangles[:, 0]], positions[triangles[:, 1]], positions[triangles[:, 2]]
    face = np.cross(b - a, c - a)
    for k in range(3):
        np.add.at(n, triangles[:, k], face)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)


def grid_triangles(rows, cols, wrap=False):
    """Triangles for a (rows x cols) vertex grid; with wrap, the last column joins the first."""
    tris = []
    last = cols if wrap else cols - 1
    for r in range(rows - 1):
        for c in range(last):
            c1 = (c + 1) % cols
            a, b, d, e = r * cols + c, r * cols + c1, (r + 1) * cols + c, (r + 1) * cols + c1
            tris += [(a, d, b), (b, d, e)]
    return np.asarray(tris, np.uint32)


def convex_hull(points):
    """2D convex hull (monotone chain), counter-clockwise."""
    pts = sorted(set(map(tuple, np.round(points, 5))))
    if len(pts) < 3:
        return np.asarray(pts)

    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2 and (out[-1][0] - out[-2][0]) * (p[1] - out[-2][1]) - (out[-1][1] - out[-2][1]) * (p[0] - out[-2][0]) <= 0:
                out.pop()
            out.append(p)
        return out

    lower, upper = half(pts), half(reversed(pts))
    return np.asarray(lower[:-1] + upper[:-1])


def polar_profile(points, centre, z, band, segments, scale=1.0, pad=0.0, convex=True):
    """Outer radius of a point cloud around a vertical axis, per angle, in a horizontal band at z.
    With convex (the default), the radius is that of the slice's convex outline, the way cloth bridges
    the hollow between the legs instead of following it in."""
    sel = np.abs(points[:, 2] - z) < band
    p = points[sel, :2] - centre
    angles = -math.pi + (np.arange(segments) + 0.5) / segments * 2 * math.pi
    if convex and len(p) >= 3:
        hull = convex_hull(p)
        prof = np.zeros(segments)
        for k, a in enumerate(angles):
            d = np.array([math.cos(a), math.sin(a)])
            best = 0.0
            for i in range(len(hull)):  # ray from the centre against each hull edge
                a0, a1 = hull[i], hull[(i + 1) % len(hull)]
                e = a1 - a0
                den = d[0] * e[1] - d[1] * e[0]
                if abs(den) < 1e-12:
                    continue
                t = (a0[0] * e[1] - a0[1] * e[0]) / den
                u = (a0[0] * d[1] - a0[1] * d[0]) / den
                if t > 0 and -1e-9 <= u <= 1 + 1e-9:
                    best = max(best, t)
            prof[k] = best
        return prof * scale + pad
    ang = np.arctan2(p[:, 1], p[:, 0])
    rad = np.hypot(p[:, 0], p[:, 1])
    bins = ((ang + math.pi) / (2 * math.pi) * segments).astype(int) % segments
    prof = np.zeros(segments)
    np.maximum.at(prof, bins, rad)
    for _ in range(segments):  # fill gaps
        empty = prof == 0
        if not empty.any():
            break
        prof[empty] = np.maximum(np.roll(prof, 1), np.roll(prof, -1))[empty]
    prof = (prof + np.roll(prof, 1) + np.roll(prof, -1)) / 3  # smooth
    return prof * scale + pad


# ---- garments --------------------------------------------------------------------------------

def lower_panel(body, bones, z_top, z_hem, flare=0.07, segments=72, rows=14, slit_from=None, pleats=None, to_ankle=False):
    """The skirt of a daura or kurtha: a tube from just under the waist to the knees, snug at the top
    and flaring at the hem, skinned so each side follows its thigh. With slit_from (a height), the
    sides are split from there down, as on a kurtha. With pleats=(count, depth), folds are gathered at
    the front, as on a sari. With to_ankle, the lower part follows the shins as well as the thighs.

    body:  bind-pose vertex positions of the body (to fit the top ring and clear the thighs)
    bones: name -> bind-pose position
    Returns dict(positions, normals, uvs, triangles, joints (names), weights).
    """
    centre = np.array([0.0, (bones['LeftUpLeg'][1] + bones['RightUpLeg'][1]) / 2])
    torso = body[np.abs(body[:, 0]) < 0.32]  # leave out the hands, which hang near the hips
    top = polar_profile(torso, centre, z_top, 0.02, segments, 1.0, 0.005)
    thighs = polar_profile(torso, centre, z_hem + 0.08, 0.06, segments, 1.0, 0.0)
    hem = np.maximum(thighs, top) + flare

    # The thighs' outline anywhere between the top and the hem: the panel never dips inside it.
    envelope = np.max([polar_profile(torso, centre, z, 0.03, segments, 1.0, 0.015)
                       for z in np.linspace(z_hem, z_top, 8)], axis=0)
    for _ in range(3):
        envelope = (np.roll(envelope, 1) + 2 * envelope + np.roll(envelope, -1)) / 4
    angles = -math.pi + (np.arange(segments) + 0.5) / segments * 2 * math.pi
    positions, uvs, weights, tris = [], [], [], []
    # Kurtha slits: at the sides (angle 0 = left, pi = right) each slit column is duplicated, and the
    # faces after the duplicate are left out below slit_from, so the two edges part.
    order = list(range(segments))
    split_cols = []
    if slit_from is not None:
        left = int(np.argmin(np.abs(angles - 0.0)))
        right = int(np.argmin(np.abs(np.abs(angles) - math.pi)))
        seq = []
        for k in range(segments):
            seq.append(k)
            if k in (left, right):
                seq.append(k)  # duplicate: the slit edge
                split_cols.append(len(seq) - 1)
        order = seq
    order = order + [order[0]]  # a closing column with its own texture coordinate, so there's no seam stripe
    for r in range(rows):
        t = r / (rows - 1)
        ease = t ** 1.4
        z = z_top + (z_hem - z_top) * t
        # Locally, too: the hips and the front of the thighs swell just below the waist.
        local = polar_profile(torso, centre, z, 0.04, segments, 1.0, 0.012)
        for _ in range(3):
            local = (np.roll(local, 1) + 2 * local + np.roll(local, -1)) / 4
        for c, k in enumerate(order):
            a = angles[k]
            reach = min(1.0, t * 2.5)  # eases out to the thighs' outline over the first part of the drop
            rad = max(top[k] + (hem[k] - top[k]) * ease, top[k] + (envelope[k] - top[k]) * reach, local[k])
            rad *= 1 + 0.025 * t * math.sin(a * 11 + 0.7)  # soft folds
            if pleats:
                count, depth = pleats
                front = math.exp(-((a + math.pi / 2) / 0.45) ** 2)  # -Y is the front
                rad += depth * front * (0.4 + 0.6 * t) * math.sin((a + math.pi / 2) * count)
            x = centre[0] + math.cos(a) * rad
            y = centre[1] + math.sin(a) * rad
            positions.append((x, y, z))
            uvs.append((c / (len(order) - 1) * 4.0, t))
            # Skinning: the hips at the top, the thigh on the same side toward the hem.
            leg = (0.95 * t ** 1.1) if to_ankle else (0.9 * t ** 1.2)
            side = np.clip(x / 0.12, -1, 1)
            calf = 0.85 * float(np.clip((t - 0.35) / 0.65, 0, 1)) if to_ankle else 0.0  # the shins carry the hem
            left, right = 0.5 + 0.5 * side, 0.5 - 0.5 * side
            weights.append({'Hips': 1 - leg, 'LeftUpLeg': leg * left * (1 - calf), 'RightUpLeg': leg * right * (1 - calf),
                            'LeftLeg': leg * left * calf, 'RightLeg': leg * right * calf})
    n_cols = len(order)
    for r in range(rows - 1):
        z_mid = z_top + (z_hem - z_top) * (r + 0.5) / (rows - 1)
        for c in range(n_cols - 1):
            c1 = c + 1
            if slit_from is not None and z_mid < slit_from and c in split_cols:
                continue  # leave the slit open
            a, b, d, e = r * n_cols + c, r * n_cols + c1, (r + 1) * n_cols + c, (r + 1) * n_cols + c1
            tris += [(a, b, d), (b, e, d)]
    positions = np.asarray(positions, np.float32)
    tris = np.asarray(tris, np.uint32)
    # Outward normals (the panel is drawn double-sided; normals face out).
    normals = vertex_normals(positions, tris)
    outward = positions[:, :2] - centre
    flip = (normals[:, 0] * outward[:, 0] + normals[:, 1] * outward[:, 1]) < 0
    if flip.mean() > 0.5:
        tris = tris[:, [0, 2, 1]]
        normals = -normals
    return {'positions': positions, 'normals': normals, 'uvs': np.asarray(uvs, np.float32), 'triangles': tris, 'weights': weights}


def dhaka_topi(head_points, bones, segments=64, rows=8, height_front=0.08, height_back=0.10):
    """A Dhaka topi: a brimless cap sitting just above the ears, its top tilted slightly up toward the
    back, with a soft vertical fold at the front. Fully skinned to the head."""
    hair_top = head_points[:, 2].max()
    base_z = hair_top - 0.11  # sits low on the head, just above the forehead and ears
    centre = np.array([np.median(head_points[np.abs(head_points[:, 2] - base_z) < 0.02, 0]),
                       np.median(head_points[np.abs(head_points[:, 2] - base_z) < 0.02, 1])])
    ring = polar_profile(head_points, centre, base_z, 0.012, segments, 1.0, 0.006)
    ring_top = polar_profile(head_points, centre, base_z + 0.03, 0.015, segments, 1.0, 0.006)
    ring = np.maximum(ring, ring_top)  # walls clear the skull as it widens above the base
    # One extra column closes the ring with its own texture coordinates, so the pattern has no seam stripe.
    angles = -math.pi + np.arange(segments + 1) / segments * 2 * math.pi
    ring = np.append(ring, ring[0])
    front = -math.pi / 2  # -Y is the front
    positions, uvs = [], []
    for r in range(rows):
        t = r / (rows - 1)
        for k, a in enumerate(angles):
            back = 0.5 - 0.5 * math.cos(a - front)  # 0 at the front, 1 at the back
            # The crown slopes front to back and, a little, from one side to the other: the topi's
            # characteristic lopsided top.
            h = height_front + (height_back - height_front) * back + 0.008 * math.cos(a)
            fold = 0.012 * math.exp(-((a - front) / 0.12) ** 2) * math.sin(math.pi * t)  # front crease
            rad = ring[k] * (1 - 0.05 * t) - fold  # walls lean in toward the top
            positions.append((centre[0] + math.cos(a) * rad, centre[1] + math.sin(a) * rad, base_z + h * t))
            uvs.append((k / segments * 4.0, 0.06 + t * 0.88))
    side_count = len(positions)
    cols = segments + 1
    tris = list(grid_triangles(rows, cols))
    # Flat top following the tilted rim: a fan from the rim's centroid.
    rim = np.asarray(positions[-cols:-1])
    cap_centre = rim.mean(axis=0)
    positions.append(tuple(cap_centre))
    uvs.append((0.5, 0.97))
    c_index = len(positions) - 1
    for k in range(segments):
        tris.append((side_count - cols + k, side_count - cols + k + 1, c_index))
    positions = np.asarray(positions, np.float32)
    tris = np.asarray(tris, np.uint32)
    normals = vertex_normals(positions, tris)
    out = positions[:, :2] - centre
    side_flip = (normals[:side_count, 0] * out[:side_count, 0] + normals[:side_count, 1] * out[:side_count, 1]) < 0
    if side_flip.mean() > 0.5:
        tris = tris[:, [0, 2, 1]]
        normals = -normals
    weights = [{'Head': 1.0}] * len(positions)
    return {'positions': positions, 'normals': normals, 'uvs': np.asarray(uvs, np.float32), 'triangles': tris, 'weights': weights,
            'fit': {'base_z': base_z, 'centre': centre, 'room': height_front - 0.012}}


def press_hair(points, fit):
    """Flattens hair under the cap, as a real topi presses it down: everything above the cap's base is
    squeezed into the room under its lowest point, so no strand pokes through."""
    out = points.copy()
    above = out[:, 2] > fit['base_z']
    top = out[above, 2].max() if above.any() else fit['base_z']
    if top - fit['base_z'] > fit['room']:
        k = fit['room'] / (top - fit['base_z'])
        out[above, 2] = fit['base_z'] + (out[above, 2] - fit['base_z']) * k
    return out


SURFACE = {}  # 'triangles': the body's triangle corners (n, 3, 3), set by the build for exact ray casts


def surface_offset(body, x, z, front=True, offset=0.02, radius=0.03):
    """y of the body surface at (x, z), seen from the front (-y) or the back (+y), pushed out by
    `offset`. Casts a ray through the body's triangles when they're known; otherwise uses the
    nearest vertices on that side."""
    tris = SURFACE.get('triangles')
    if tris is not None:
        # Moller-Trumbore against every triangle, ray along +y from far in front (or -y from behind).
        d = np.array([0.0, 1.0 if front else -1.0, 0.0])
        o = np.array([x, -2.0 if front else 2.0, z])
        v0, e1, e2 = tris[:, 0], tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
        pv = np.cross(d, e2)
        det = np.einsum('ij,ij->i', e1, pv)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
        tv = o - v0
        u = np.einsum('ij,ij->i', tv, pv) * inv
        qv = np.cross(tv, e1)
        v = (qv @ d) * inv
        t = np.einsum('ij,ij->i', e2, qv) * inv
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0)
        if hit.any():
            y = o[1] + d[1] * t[hit].min()
            return y - offset if front else y + offset
    side = body[:, 1] < np.median(body[:, 1]) if front else body[:, 1] >= np.median(body[:, 1])
    pts = body[side]
    dist = np.hypot(pts[:, 0] - x, pts[:, 2] - z)
    near = pts[dist < radius]
    if len(near) == 0:
        near = pts[np.argsort(dist)[:6]]
    return near[:, 1].min() - offset if front else near[:, 1].max() + offset


def dupatta(body, bones, width=0.105, gap=0.012):
    """A dupatta draped in a U across the chest, over both shoulders and hanging down the back.
    Its centre line follows the body a couple of centimetres off the surface; skinned to the chest at
    the front, the shoulders on top and the upper back behind."""
    shoulders = {}
    for side, bone in (('Left', bones['LeftArm']), ('Right', bones['RightArm'])):
        x = bone[0] * 0.72  # on the shoulder, so the two hanging ends stay apart
        near = body[(np.abs(body[:, 0] - x) < 0.03) & (np.abs(body[:, 1] - bone[1]) < 0.06) & (body[:, 2] < bones['Head'][2])]
        shoulders[side] = (x, near[:, 2].max() + gap)
    chest_low = bones['Spine1'][2] - 0.04  # the U dips to just above the waist
    end_z = bones['Hips'][2] - 0.18  # the ends hang to the upper thigh behind

    pts, normals, joints = [], [], []

    def add(p, n, w):
        pts.append(np.asarray(p, np.float32))
        normals.append(np.asarray(n, np.float32))
        joints.append(w)

    def hang(side, downward):
        x, top = shoulders[side]
        zs = np.linspace(end_z, top - 0.06, 12)
        for z in (zs[::-1] if downward else zs):
            k = float(np.clip((z - end_z) / (top - end_z), 0, 1))
            add((x, surface_offset(body, x, z, False, gap), z), (0, 1, 0), {'Spine2': 0.3 + 0.7 * k, 'Spine1': 0.7 - 0.7 * k})

    def over(side, to_front):
        x, top = shoulders[side]
        yb = surface_offset(body, x, top - 0.06, False, gap)
        yf = surface_offset(body, x, top - 0.06, True, gap)
        for u in np.linspace(0, 1, 9)[1:-1]:
            u = u if to_front else 1 - u
            a = math.pi * u
            add((x, yb + (yf - yb) * u, top - 0.06 + 0.06 * math.sin(a)), (0, math.cos(a), math.sin(a)),
                {f'{side}Shoulder': 0.5, 'Spine2': 0.5})

    def front():
        xr, top_r = shoulders['Right']
        xl, top_l = shoulders['Left']
        top = (top_r + top_l) / 2 - 0.06
        for u in np.linspace(0, 1, 30):
            x = xr + (xl - xr) * u
            z = top - (top - chest_low) * math.sin(math.pi * u)
            add((x, surface_offset(body, x, z, True, gap), z), (0, -1, 0), {'Spine2': 0.85, 'Spine1': 0.15})

    hang('Right', downward=False)
    over('Right', to_front=True)
    front()
    over('Left', to_front=False)
    hang('Left', downward=True)

    c = np.asarray(pts)
    n = np.asarray(normals)
    for _ in range(3):  # smooth the corners where the segments meet
        c[1:-1] = (c[:-2] + 2 * c[1:-1] + c[2:]) / 4
        n[1:-1] = (n[:-2] + 2 * n[1:-1] + n[2:]) / 4
    positions, uvs, weights = [], [], []
    length = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))])
    for i, p in enumerate(c):
        tangent = c[min(i + 1, len(c) - 1)] - c[max(i - 1, 0)]
        tangent /= np.linalg.norm(tangent) + 1e-9
        across = np.cross(tangent, n[i])
        across /= np.linalg.norm(across) + 1e-9
        for j, v in enumerate(np.linspace(-0.5, 0.5, 7)):
            pleat = 0.007 * math.sin(v * 8 * math.pi)  # soft gathered folds across the width
            positions.append(p + across * width * v + n[i] / (np.linalg.norm(n[i]) + 1e-9) * pleat)
            uvs.append((length[i] / width, v + 0.5))
            weights.append(joints[i])
    positions = np.asarray(positions, np.float32)
    tris = grid_triangles(len(c), 7)
    return {'positions': positions, 'normals': vertex_normals(positions, tris), 'uvs': np.asarray(uvs, np.float32),
            'triangles': tris, 'weights': weights}


def pallu(body, bones, gap=0.014):
    """The pallu of a sari: from the waist on the right, diagonally up across the chest, over the left
    shoulder, and hanging down the back to the knees, widening as it falls. UV u runs along its length
    (0 at the waist, 1 at the free end), v across it."""
    lx = bones['LeftArm'][0] * 0.66
    near = body[(np.abs(body[:, 0] - lx) < 0.03) & (np.abs(body[:, 1] - bones['LeftArm'][1]) < 0.06) & (body[:, 2] < bones['Head'][2])]
    top = near[:, 2].max() + gap
    waist = bones['Hips'][2] + 0.05
    end_z = bones['LeftLeg'][2] + 0.06

    pts, normals, joints, widths = [], [], [], []

    def add(p, n, w, width):
        pts.append(np.asarray(p, np.float32))
        normals.append(np.asarray(n, np.float32))
        joints.append(w)
        widths.append(width)

    # Across the front: from the right hip up to the left shoulder.
    for u in np.linspace(0, 1, 26):
        x = -0.13 + (lx + 0.13) * u
        z = waist + (top - 0.06 - waist) * u
        k = float(u)
        add((x, surface_offset(body, x, z, True, gap), z), (0, -1, 0),
            {'Hips': 0.6 * (1 - k), 'Spine1': 0.4, 'Spine2': 0.6 * k}, 0.24 + 0.04 * u)
    # Over the shoulder.
    yf = surface_offset(body, lx, top - 0.06, True, gap)
    yb = surface_offset(body, lx, top - 0.06, False, gap)
    for u in np.linspace(0, 1, 9)[1:-1]:
        a = math.pi * u
        add((lx, yf + (yb - yf) * u, top - 0.06 + 0.06 * math.sin(a)), (0, -math.cos(a), math.sin(a)),
            {'LeftShoulder': 0.5, 'Spine2': 0.5}, 0.28)
    # Down the back, widening.
    for u in np.linspace(0, 1, 24):
        z = top - 0.06 - (top - 0.06 - end_z) * u
        x = lx - 0.06 * u
        h = float(np.clip((z - bones['Hips'][2]) / (top - bones['Hips'][2]), 0, 1))
        y = surface_offset(body, x, max(z, bones['Hips'][2] - 0.1), False, gap + 0.02 * u)
        add((x, y, z), (0, 1, 0), {'Spine2': 0.6 * h, 'Spine1': 0.4 * h + 0.2 * (1 - h), 'Hips': 0.8 * (1 - h)}, 0.28 + 0.12 * u)

    c = np.asarray(pts)
    n = np.asarray(normals)
    for _ in range(3):
        c[1:-1] = (c[:-2] + 2 * c[1:-1] + c[2:]) / 4
        n[1:-1] = (n[:-2] + 2 * n[1:-1] + n[2:]) / 4
    length = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))])
    positions, uvs, weights = [], [], []
    cols = 9
    for i, p in enumerate(c):
        tangent = c[min(i + 1, len(c) - 1)] - c[max(i - 1, 0)]
        tangent /= np.linalg.norm(tangent) + 1e-9
        normal = n[i] / (np.linalg.norm(n[i]) + 1e-9)
        across = np.cross(tangent, normal)
        across /= np.linalg.norm(across) + 1e-9
        for v in np.linspace(-0.5, 0.5, cols):
            fold = 0.01 * math.sin(v * 7 * math.pi) * (0.5 + 0.5 * length[i] / length[-1])
            positions.append(p + across * widths[i] * v + normal * fold)
            uvs.append((length[i] / length[-1], v + 0.5))
            weights.append(joints[i])
    positions = np.asarray(positions, np.float32)
    tris = grid_triangles(len(c), cols)
    return {'positions': positions, 'normals': vertex_normals(positions, tris), 'uvs': np.asarray(uvs, np.float32),
            'triangles': tris, 'weights': weights}


def transfer_weights(points, body_points, body_joints, body_weights, joint_names, k=4):
    """Skin weights for a close-fitting garment, copied from the nearest body vertices (inverse-distance
    blend of k), so it moves exactly like the skin beneath it in every pose."""
    out = []
    for p in points:
        d = np.linalg.norm(body_points - p, axis=1)
        idx = np.argpartition(d, k)[:k]
        w = 1 / np.maximum(d[idx], 1e-4) ** 2
        w /= w.sum()
        acc = {}
        for i, wi in zip(idx, w):
            for j, x in zip(body_joints[i], body_weights[i]):
                if x > 0:
                    name = joint_names[int(j)]
                    acc[name] = acc.get(name, 0) + float(x * wi)
        out.append(acc)
    return out


def skin_attributes(weights, joint_names):
    """Turns per-vertex {bone name: weight} dicts into JOINTS_0 / WEIGHTS_0 arrays for the skin."""
    index = {n: i for i, n in enumerate(joint_names)}
    joints = np.zeros((len(weights), 4), np.uint16)
    w = np.zeros((len(weights), 4), np.float32)
    for v, d in enumerate(weights):
        items = sorted(((k, x) for k, x in d.items() if x > 1e-4), key=lambda kv: -kv[1])[:4]
        total = sum(x for _, x in items) or 1
        for s, (name, x) in enumerate(items):
            joints[v, s] = index[name]
            w[v, s] = x / total
    return joints, w
