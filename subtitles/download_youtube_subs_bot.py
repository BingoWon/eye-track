#!/usr/bin/env python3
import os
import subprocess
import glob
import json
import shutil
import sys

def main(channel_url, author_id, cookies_browser="edge", date_after="20230331"):
    # Ensure target directory exists
    target_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), author_id)
    os.makedirs(target_dir, exist_ok=True)
    
    tmp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"tmp_subs_{author_id}")
    os.makedirs(tmp_dir, exist_ok=True)
    
    print(f"Downloading metadata and subtitles to {tmp_dir} directory...")
    cmd = [
        "yt-dlp",
        "--cookies-from-browser", cookies_browser,
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-format", "json3",
        "--sub-langs", "en.*,en-US,en", 
        "--write-info-json",
        "--dateafter", date_after,
        "-o", f"{tmp_dir}/%(id)s.%(ext)s",
        channel_url
    ]

    subprocess.run(cmd, check=True)

    print("\nProcessing downloaded files...")
    for info_file in glob.glob(f"{tmp_dir}/*.info.json"):
        video_id = os.path.basename(info_file).replace(".info.json", "")
        with open(info_file, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        
        # clean title format for filename
        title = meta.get("title", "Unknown Title").replace("/", "_").replace(":", " -")
        upload_date = meta.get("upload_date", "UnknownDate")
        description = meta.get("description", "")
        
        # Check for English subtitles only
        sub_file = None
        for pattern in ["*.en.json3", "*.en-orig.json3", "*.en-*.json3"]:
            matches = glob.glob(f"{tmp_dir}/{video_id}{pattern}")
            if matches:
                sub_file = matches[0]
                break
                
        if not sub_file:
            print(f"No English subtitles found for {title}. Attempting auto-generated English if available.")
            for pattern in ["*.json3"]:
                matches = glob.glob(f"{tmp_dir}/{video_id}{pattern}")
                if matches and 'en' in matches[0]:
                    sub_file = matches[0]
                    break

        if not sub_file:
            print(f"Still no English subtitles found for {title}. Skipping subtitle extraction.")
            transcript = "[No English subtitles available for this video]"
        else:
            # Parse json3 (duplicate lines + overlap removal)
            with open(sub_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            text_lines = []
            current_line = ""
            for event in data.get('events', []):
                for seg in event.get('segs', []):
                    text = seg.get('utf8', '')
                    if text == '\n':
                        if current_line.strip():
                            text_lines.append(current_line.strip())
                        current_line = ""
                    else:
                        current_line += text
                if current_line.strip():
                    text_lines.append(current_line.strip())
                    current_line = ""
                    
            final_lines = []
            for line in text_lines:
                cleaned = line.strip().replace('\u200b', '')
                if not cleaned: continue
                if not final_lines or final_lines[-1] != cleaned:
                    final_lines.append(cleaned)
                    
            deduped_content = []
            for line in final_lines:
                if not deduped_content:
                    deduped_content.append(line)
                else:
                    prev = deduped_content[-1]
                    if line.startswith(prev):
                        deduped_content[-1] = line
                    elif prev.startswith(line):
                        pass
                    else:
                        deduped_content.append(line)
                        
            transcript = " ".join(deduped_content)
        
        # Save output to author directory
        out_filename = os.path.join(target_dir, f"{upload_date} {title}.txt")
        with open(out_filename, "w", encoding='utf-8') as f:
            f.write(f"Title: {title}\n")
            f.write(f"Date: {upload_date}\n")
            f.write(f"Description:\n{description}\n\n{'='*40}\nSubtitles:\n\n{transcript}")
            
        print(f"Saved: {out_filename}")

    try:
        shutil.rmtree(tmp_dir)
        print("Cleanup complete.")
    except Exception as e:
        print(f"Warning: Failed to cleanup tmp directory {tmp_dir}: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        # Default behavior uses user's explicit request
        print("Using default settings for jeoresearch.")
        main("https://www.youtube.com/@jeoresearch/videos", "jeoresearch")
    else:
        main(sys.argv[1], sys.argv[2])
