# สร้าง data/hillshade.webp (ภูมิประเทศสีตามความสูง + เงา) และ data/amphoe.geojson
# ใช้: python tools/build_map_extras.py source/   (ต้องมี Dem_ping.tif, subbasin_ping.gpkg, tambon_ping.gpkg)
import sys, os, re, json, warnings, numpy as np, geopandas as g, rasterio
from rasterio.features import geometry_mask
from affine import Affine
from PIL import Image
warnings.filterwarnings('ignore')
D = sys.argv[1] if len(sys.argv)>1 else 'source/'
OUT = os.path.join(os.path.dirname(__file__),'..','data')+'/'
d=rasterio.open(D+'Dem_ping.tif')
z=d.read(1).astype(float); z[z==d.nodata]=np.nan
zz=np.nan_to_num(z,nan=np.nanmin(z))
# upsample 3x for smooth result
im=Image.fromarray(zz.astype(np.float32)); zz=np.array(im.resize((zz.shape[1]*3,zz.shape[0]*3),Image.BICUBIC))
lat=np.deg2rad(17.7); dx=d.res[0]/3*111320*np.cos(lat); dy=d.res[1]/3*110540
gy,gx=np.gradient(zz,dy,dx)
slope=np.arctan(np.hypot(gx,gy)*2.2); aspect=np.arctan2(-gx,gy)
az,alt=np.deg2rad(315),np.deg2rad(40)
hs=np.clip(np.sin(alt)*np.cos(slope)+np.cos(alt)*np.sin(slope)*np.cos(az-aspect),0,1)
stops=[(0,(226,236,214)),(150,(214,230,196)),(400,(190,215,165)),(700,(205,212,160)),(1000,(214,196,150)),(1400,(190,160,118)),(1800,(160,128,96)),(2600,(236,232,226))]
r=np.zeros(zz.shape+(3,))
e=[s[0] for s in stops]
for c in range(3): r[...,c]=np.interp(zz,e,[s[1][c] for s in stops])
shade=0.45+0.65*hs
rgb=np.clip(r*shade[...,None],0,255)
sb=g.read_file(D+'subbasin_ping.gpkg').to_crs(4326)
tr=d.transform*Affine.scale(1/3)
m=geometry_mask([sb.union_all()],out_shape=zz.shape,transform=tr,invert=True)
a=np.where(m,255,90).astype(np.uint8)
nan=np.array(Image.fromarray(np.isnan(z).astype(np.uint8)*255).resize((zz.shape[1],zz.shape[0])))>127
a[nan]=0
out=np.dstack([rgb.astype(np.uint8),a])
Image.fromarray(out,'RGBA').resize((zz.shape[1]*2//3,zz.shape[0]*2//3),Image.LANCZOS).save(OUT+'hillshade.webp',quality=82,method=6)
print('ok')
b=d.bounds; json.dump([[b.bottom,b.left],[b.top,b.right]],open(OUT+'hillshade_bounds.json','w'))
# amphoe boundaries from tambons used in the dashboard
ids={x['id'] for x in json.load(open(OUT+'master.json'))['tambons']}
t=g.read_file(D+'tambon_ping.gpkg'); t=t[t.TAMBON_IDN.astype(str).isin(ids)].copy()
s=lambda v,p: re.sub('^'+p+r'\.\s*','',v).strip()
t['key']=t.PROV_NAM_T.map(lambda v:s(v,'จ'))+'|'+t.AMPHOE_T.map(lambda v:s(v,'อ'))
a=t[['key','geometry']].dissolve('key').reset_index().to_crs(32647)
a['geometry']=a.geometry.simplify(150,preserve_topology=True)
a.to_crs(4326).to_file(OUT+'amphoe.geojson',driver='GeoJSON',COORDINATE_PRECISION=4)
print('done')
