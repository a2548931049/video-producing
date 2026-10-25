# Terrain data attribution

`near.png`, `mid.png` and `far.png` are resampled from AWS Terrain Tiles
(<https://registry.opendata.aws/terrain-tiles/>, terrarium encoding) by `tools/bake-terrain.mjs`.
The tiles merge several open elevation sources, which ask to be credited wherever the data is shown
(for a published video: in its description or credits). The required lines, from
<https://github.com/tilezen/joerd/blob/master/docs/attribution.md>:

- ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded under National
  Science Foundation awards 1043681, 1559691, and 1542736;
- Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;
- Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich;
- Canada terrain data contains information licensed under the Open Government Licence – Canada;
- Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers;
- Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration
- Mexico terrain data source: INEGI, Continental relief, 2016;
- New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand
  Government (All rights reserved);
- Norway terrain data © Kartverket;
- United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved;
- United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.

The area used here (Putorana Plateau, around 69.4° N 90° E) is covered by the ArcticDEM, GMTED2010 and
ETOPO1 lines; the full list is kept because the tiles don't say which source each pixel came from.
