import os
import zipfile
import shutil

EXCLUDE_DIRS = {'node_modules', '.git', '.aistudio', 'dist', 'tmp'}
EXCLUDE_EXTS = {'.zip'}

def make_zip(output_filename, source_dir):
    with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for file in files:
                if any(file.endswith(ext) for ext in EXCLUDE_EXTS):
                    continue
                if file.startswith('.env'):
                    continue
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, source_dir)
                zipf.write(file_path, arcname)

if __name__ == '__main__':
    zip_name = 'la-conquista-E0.zip'
    make_zip(zip_name, '.')
    artifact_dest = '/.aistudio/artifacts/brain/496cd4f1-0c51-4d12-bab3-0941aaa1583d/'
    if os.path.exists(artifact_dest):
        shutil.copy2(zip_name, os.path.join(artifact_dest, zip_name))
    print('Zip created successfully:', os.path.getsize(zip_name), 'bytes')
