"""Run in Blender with --disable-autoexec. Read source data, never its scripts."""
import bpy, json
from mathutils import Matrix
from pathlib import Path
root=Path('/Users/vtn/dev/Syn3h-wt/vehicles2/public/models')
bpy.ops.wm.open_mainfile(filepath='/tmp/syn3h-research/legacy/syn3h-client/Assets/_Actors/Packages/Jet/Components/Core Jet.blend')
deps=bpy.context.evaluated_depsgraph_get()
objects=[]
for name in ['Body_Main','Body_Chrome','Body_Cockpit','Collider','Landing Gear']:
 o=bpy.data.objects[name]
 mesh=bpy.data.meshes.new_from_object(o.evaluated_get(deps),depsgraph=deps)
 # Mesh coordinates are Unity-ready; prefab drops the Blender authoring transforms.
 offset=-.083 if name=='Landing Gear' else -.1 if name=='Collider' else -.13
 if name=='Collider':
  points=[]
  for v in mesh.vertices: points.extend([round(v.co.x,6),round(v.co.y+offset,6),round(-v.co.z,6)])
  (root/'jet-collider.json').write_text(json.dumps(points))
 # Blender export converts (x,z,y) to glTF (x,y,-z).
 for v in mesh.vertices: v.co=(v.co.x,v.co.z,v.co.y+offset)
 mesh.flip_normals()
 ob=bpy.data.objects.new(name+'_export',mesh);objects.append((ob,name))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for ob,name in objects:
 bpy.context.collection.objects.link(ob);ob.name=name;ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(root/'jet.glb'),export_format='GLB',export_yup=True,use_selection=True)
