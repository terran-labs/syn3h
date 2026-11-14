"""Decode owner-authored Cheetah3D mesh data without running project code."""
import bpy, bmesh, plistlib, struct, math
from pathlib import Path
root=Path('/Users/vtn/dev/Syn3h-wt/vehicles2/public/models')
source=Path('/tmp/syn3h-research/legacy/syn3h-client/Assets/_Actors/Packages/Hovercraft/Components/Model/Hovercraft.jas')
data=plistlib.loads(source.read_bytes())
bpy.ops.wm.read_factory_settings(use_empty=True)
# Cheetah's Unity import uses centimetres; .0315 importer scale gives 3.15 here.
scale=3.15
for item in data['Objects']:
 if item.get('type')!='NGON': continue
 assert item['position']==[0,0,0] and item['rotation']==[0,0,0] and item['scale']==[1,1,1]
 raw=list(struct.iter_unpack('>ffff',item['vertex']))
 vertices=[(x*scale,z*scale,y*scale) for x,y,z,_ in raw]
 indices=list(struct.unpack('>'+'i'*(len(item['polygons'])//4),item['polygons']))
 faces=[];offset=0
 while offset<len(indices):
  count=-indices[offset];assert count>=3
  faces.append(tuple(indices[offset+1:offset+1+count]))
  offset+=1+count
 assert len(faces)==item['polygoncount'] and len(vertices)==item['vertexcount']
 mesh=bpy.data.meshes.new(item['name']);mesh.from_pydata(vertices,[],faces);mesh.update()
 # Preserve UVs, reversing corners to match the handedness conversion.
 uv=list(struct.iter_unpack('>ffff',item['uvcoords']))
 uv_layer=mesh.uv_layers.new(name='UVMap');offset=0
 for poly in mesh.polygons:
  for loop,coord in zip(poly.loop_indices,uv[offset:offset+poly.loop_total]): uv_layer.data[loop].uv=coord[:2]
  offset+=poly.loop_total
 # Cheetah polygons are clockwise. Repair connected surface normals and split hard edges.
 bm=bmesh.new();bm.from_mesh(mesh)
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
 hard=[e for e in bm.edges if len(e.link_faces)==2 and e.calc_face_angle()>math.radians(60)]
 bmesh.ops.split_edges(bm,edges=hard)
 bm.to_mesh(mesh);bm.free()
 for poly in mesh.polygons: poly.use_smooth=True
 obj=bpy.data.objects.new(item['name'],mesh);bpy.context.collection.objects.link(obj)
 print(item['name'],len(vertices),len(faces),tuple(obj.dimensions))
bpy.ops.export_scene.gltf(filepath=str(root/'hovercraft.glb'),export_format='GLB',export_yup=True)
