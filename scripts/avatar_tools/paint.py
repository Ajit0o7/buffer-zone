"""Painting in 3D: find, for every texel of a texture, the point on the body it lands on (in the bind
pose), so clothes can be repainted by body region (torso, thighs, feet...) instead of by guessing at
the texture's UV layout."""
import numpy as np


def position_map(uv, positions, triangles, size):
    """Rasterises the mesh in UV space. Returns (points, normals-free mask): an array of shape
    (size, size, 3) holding the bind-pose position under each texel, and a boolean coverage mask."""
    out = np.zeros((size, size, 3), np.float32)
    mask = np.zeros((size, size), bool)
    px = uv * size - 0.5  # texel centres
    for a, b, c in triangles:
        (x0, y0), (x1, y1), (x2, y2) = px[a], px[b], px[c]
        xmin, xmax = int(max(np.floor(min(x0, x1, x2)), 0)), int(min(np.ceil(max(x0, x1, x2)), size - 1))
        ymin, ymax = int(max(np.floor(min(y0, y1, y2)), 0)), int(min(np.ceil(max(y0, y1, y2)), size - 1))
        if xmax < xmin or ymax < ymin:
            continue
        det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(det) < 1e-12:
            continue
        xs, ys = np.meshgrid(np.arange(xmin, xmax + 1), np.arange(ymin, ymax + 1))
        w0 = ((y1 - y2) * (xs - x2) + (x2 - x1) * (ys - y2)) / det
        w1 = ((y2 - y0) * (xs - x2) + (x0 - x2) * (ys - y2)) / det
        w2 = 1 - w0 - w1
        inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)  # a little slack fills seams
        if not inside.any():
            continue
        p = w0[..., None] * positions[a] + w1[..., None] * positions[b] + w2[..., None] * positions[c]
        ys_in, xs_in = ys[inside], xs[inside]
        out[ys_in, xs_in] = p[inside]
        mask[ys_in, xs_in] = True
    return out, mask


def dilate(image, mask, steps=4):
    """Spreads painted texels outward by a few pixels, so mip-mapping never pulls in old colours at seams."""
    image = image.copy()
    mask = mask.copy()
    for _ in range(steps):
        grow = np.zeros_like(mask)
        acc = np.zeros(image.shape, np.float32)
        count = np.zeros(mask.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            shifted_mask = np.roll(np.roll(mask, dy, 0), dx, 1)
            shifted = np.roll(np.roll(image, dy, 0), dx, 1)
            acc += shifted * shifted_mask[..., None]
            count += shifted_mask
        grow = (~mask) & (count > 0)
        image[grow] = (acc[grow] / count[grow][:, None])
        mask |= grow
    return image, mask


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def recolour(rgb, region, colour, keep_shading=1.0):
    """Replaces the fabric colour in `region` with `colour` (0..1 RGB, or an HxWx3 pattern), keeping the
    original folds and shading: the new colour is scaled by each texel's brightness relative to the
    region's median brightness."""
    lum = luminance(rgb)
    ref = np.median(lum[region]) if region.any() else 1.0
    shade = np.clip((lum / max(ref, 1e-3)) ** keep_shading, 0.35, 1.6)
    colour = np.asarray(colour, np.float32)
    target = colour[region] if colour.ndim == 3 else colour[None, :]
    rgb = rgb.copy()
    rgb[region] = np.clip(target * shade[region][:, None], 0, 1)
    return rgb
