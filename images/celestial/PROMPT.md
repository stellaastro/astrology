# Hero foreground

Generated with the built-in imagegen tool. Source: `assembly.png`.
The background is the user-supplied `../herosection/hero_bg.png`.

## Generation prompt

Use case: stylized-concept. Create a premium photorealistic 3D celestial assembly cutout for an astrology website hero, on a genuinely transparent background. Square 1536x1536 composition, all objects completely within frame with 5% transparent padding. Main object: a huge antique brass astrolabe zodiac wheel, almost front facing with very slight perspective tilt, occupying central 65% of canvas. Twelve engraved western zodiac symbols around outer ivory-gold segments, many concentric intricate engraved brass rings, ornate central sculpted sun compass with a lotus-like sunburst. NO brand logo, NO swastika, NO text or letters except engraved zodiac glyphs. Rich realistic weathered champagne gold metal, fine etching, physically believable bevels, deep ambient occlusion. Around wheel: large photorealistic Saturn with delicate golden rings in upper right, cratered ivory moon upper left, rusty orange Mars lower left overlapping edge, small olive-green planet right, small ornate brass crescent far right, detailed gold armillary sphere on short pedestal lower right. Several fine sweeping gold elliptical orbital wires connect composition. Objects feel lavish and museum-quality, not flat vector or cartoon. Warm soft sunlight from upper left, subtle realistic shadows on objects. Palette warm antique gold, cream, terracotta, olive. NO sky, NO landscape, NO cloud background, NO floor, NO solid background, NO typography. This is a transparent isolated foreground to layer over an existing ivory cloud palace landscape. Compose like a luxurious Renaissance celestial clock surrounded by floating planets, wheel overwhelmingly dominant.

## Separated artwork edit — 2026-09-15

Built-in imagegen edit of the original artwork preview. Output:
`separated-sheet.png`. Web assets are extracted by `scripts/build-assets.mjs`.
The output had a baked neutral checkerboard; the asset build removes connected
neutral backdrop pixels before exporting the six transparent WebP layers.

### Edit prompt

Edit the celestial artwork shown in the latest conversation image into one transparent PNG sprite sheet for website animation. Preserve its antique gold photoreal sculptural style and recognizable designs. Square canvas divided into a strict 3-column by 2-row grid of equal rectangular cells, each object centred in its cell with generous transparent padding and no overlap between cells. Top left cell: ONLY the complete large zodiac main dial with sun face and gold rim, restoring rim details formerly occluded by planets; remove all planets, moons, orbit lines, beads, crescent and globe from this dial. Top middle: ONLY original cratered full moon. Top right: ONLY original golden Saturn planet with rings. Bottom left: ONLY original rust-red planet, no orbit lines. Bottom middle: ONLY original small green-gold textured planet. Bottom right: ONLY original gold crescent moon. Remove the grilled armillary globe on its stand entirely, it must appear nowhere. Every object isolated on actual alpha transparency, no black or white background, no labels or grid lines. Each object fills 75-85% of cell width while remaining completely within its cell. This technical sheet will be cropped into six equal cells so the strict equal 3x2 arrangement is essential.
