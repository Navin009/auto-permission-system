#!/usr/bin/env python3
"""
generate-recording.py
Generates a crisp, high-definition widescreen (1200x580), cinematic terminal recording
demonstrating auto-permission-system features:
1. L2 Interactive .env read prompt (Ask tier with live countdown)
2. L1 OS Sandbox kernel write boundary (Bubblewrap EROFS refusal)
3. L1 Network domain intercept with countdown
4. Advanced Secure real-time API key & secret token redaction
5. Cloud Auto Mode: Secure autonomous execution for Pi (like Claude auto mode)

Outputs:
- assets/demo.mp4 (High-res Full HD MP4)
- assets/demo.gif (High-res palette-optimized GIF)
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
from PIL import Image, ImageDraw, ImageFont

WIDTH = 1200
HEIGHT = 580
PADDING = 20
TERMINAL_X = PADDING
TERMINAL_Y = PADDING
TERMINAL_W = WIDTH - 2 * PADDING
TERMINAL_H = HEIGHT - 2 * PADDING
TITLEBAR_H = 42

# Fonts
MONO_PATH = "/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Regular.ttf"
if not os.path.exists(MONO_PATH):
    MONO_PATH = "/usr/share/fonts/liberation-mono-fonts/LiberationMono-Regular.ttf"

EMOJI_PATH = "/usr/share/fonts/google-noto-emoji-fonts/NotoEmoji-Regular.ttf"
SANS_PATH = "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf"

FONT_SIZE = 16
font_mono = ImageFont.truetype(MONO_PATH, FONT_SIZE)
font_mono_bold = ImageFont.truetype(MONO_PATH, FONT_SIZE)
font_emoji = ImageFont.truetype(EMOJI_PATH, FONT_SIZE)
font_title = ImageFont.truetype(SANS_PATH, 13)

# Colors
BG_CANVAS = (13, 17, 23)          # Outer canvas #0d1117
BG_TERM = (22, 27, 34)            # Terminal window #161b22
BG_TITLEBAR = (33, 38, 45)        # Title bar #21262d
BORDER_TERM = (48, 54, 61)        # Border #30363d

FG_TEXT = (230, 237, 243)         # Main text #e6edf3
FG_MUTED = (139, 148, 158)        # Muted gray #8b949e
FG_CYAN = (88, 166, 255)          # Cyan/Blue #58a6ff
FG_GREEN = (63, 185, 80)          # Green #3fb950
FG_YELLOW = (210, 153, 34)        # Yellow #d29922
FG_RED = (248, 81, 73)            # Red #f85149
FG_PURPLE = (188, 140, 255)       # Purple #bc8cff
FG_ORANGE = (255, 166, 87)        # Orange #ffa657

BTN_RED = (255, 95, 86)
BTN_YELLOW = (255, 189, 46)
BTN_GREEN = (39, 201, 63)

SEL_BG = (31, 45, 71)             # Selected menu item background
CARD_BG = (17, 22, 29)            # Prompt card background
CARD_BORDER = (56, 68, 85)

EMOJI_PATTERN = re.compile(r'([🔒🛡⚡🔑🌐⚠🧠]+)')

def draw_styled_segment(draw, x, y, text, color, bold=False):
    cur_x = x
    tokens = EMOJI_PATTERN.split(text)
    for tok in tokens:
        if not tok:
            continue
        if EMOJI_PATTERN.fullmatch(tok):
            draw.text((cur_x, y), tok, font=font_emoji, fill=color)
            bbox = font_emoji.getbbox(tok)
            cur_x += (bbox[2] - bbox[0]) + 4
        else:
            f = font_mono_bold if bold else font_mono
            draw.text((cur_x, y), tok, font=f, fill=color)
            bbox = f.getbbox(tok)
            cur_x += (bbox[2] - bbox[0])
    return cur_x

def draw_terminal_base():
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_CANVAS)
    draw = ImageDraw.Draw(img)

    # Terminal card with rounded corners
    draw.rounded_rectangle(
        [TERMINAL_X, TERMINAL_Y, TERMINAL_X + TERMINAL_W, TERMINAL_Y + TERMINAL_H],
        radius=12,
        fill=BG_TERM,
        outline=BORDER_TERM,
        width=1,
    )

    # Title bar
    draw.rounded_rectangle(
        [TERMINAL_X, TERMINAL_Y, TERMINAL_X + TERMINAL_W, TERMINAL_Y + TITLEBAR_H],
        radius=12,
        fill=BG_TITLEBAR,
        outline=BORDER_TERM,
        width=1,
    )
    draw.rectangle(
        [TERMINAL_X, TERMINAL_Y + TITLEBAR_H - 12, TERMINAL_X + TERMINAL_W, TERMINAL_Y + TITLEBAR_H],
        fill=BG_TITLEBAR,
    )
    draw.line(
        [TERMINAL_X, TERMINAL_Y + TITLEBAR_H, TERMINAL_X + TERMINAL_W, TERMINAL_Y + TITLEBAR_H],
        fill=BORDER_TERM,
        width=1,
    )

    # Window controls (radius 7px)
    btn_y = TERMINAL_Y + TITLEBAR_H // 2
    draw.ellipse([TERMINAL_X + 18, btn_y - 7, TERMINAL_X + 32, btn_y + 7], fill=BTN_RED)
    draw.ellipse([TERMINAL_X + 40, btn_y - 7, TERMINAL_X + 54, btn_y + 7], fill=BTN_YELLOW)
    draw.ellipse([TERMINAL_X + 62, btn_y - 7, TERMINAL_X + 76, btn_y + 7], fill=BTN_GREEN)

    # Title
    title = "pi — auto-permission-system v3.8.0 (Secure Auto Mode & Zero-Trust Sandbox)"
    draw.text((TERMINAL_X + 98, TERMINAL_Y + 12), title, font=font_title, fill=FG_MUTED)

    return img

def render_lines(draw, lines, start_y=TERMINAL_Y + TITLEBAR_H + 18, start_x=TERMINAL_X + 24):
    curr_y = start_y
    for item in lines:
        if isinstance(item, tuple):
            text, color, is_bold = item
            draw_styled_segment(draw, start_x, curr_y, text, color, is_bold)
            curr_y += 25
        elif isinstance(item, list):
            curr_x = start_x
            for seg_text, seg_color, seg_bold in item:
                curr_x = draw_styled_segment(draw, curr_x, curr_y, seg_text, seg_color, seg_bold)
            curr_y += 25
        elif item == "SPACER":
            curr_y += 12
    return curr_y

def render_prompt_box(draw, box_y, box_h, title_lines, options, selected_idx, footer=None, default_hint=None):
    box_x = TERMINAL_X + 26
    box_w = TERMINAL_W - 52

    draw.rounded_rectangle(
        [box_x, box_y, box_x + box_w, box_y + box_h],
        radius=8,
        fill=CARD_BG,
        outline=CARD_BORDER,
        width=1,
    )

    y = box_y + 14
    for t_text, t_color, t_bold in title_lines:
        draw_styled_segment(draw, box_x + 18, y, t_text, t_color, t_bold)
        y += 24

    if footer:
        y += 5
        draw.line([box_x + 18, y, box_x + box_w - 18, y], fill=BORDER_TERM, width=1)
        y += 8
        draw_styled_segment(draw, box_x + 18, y, footer, FG_MUTED, False)
        y += 22

    y += 6
    for idx, opt in enumerate(options):
        is_sel = (idx == selected_idx)
        opt_y = y
        if is_sel:
            draw.rounded_rectangle(
                [box_x + 16, opt_y - 3, box_x + box_w - 16, opt_y + 23],
                radius=4,
                fill=SEL_BG,
            )
            draw_styled_segment(draw, box_x + 24, opt_y, f"→  {opt}", FG_CYAN, True)
        else:
            draw_styled_segment(draw, box_x + 24, opt_y, f"   {opt}", FG_TEXT, False)
        y += 27

    if default_hint:
        y += 6
        draw_styled_segment(draw, box_x + 24, y, default_hint, FG_MUTED, False)

def create_frames():
    frames = []

    # ----------------------------------------------------
    # SCENE 1: Agent startup in Secure Auto Mode
    # ----------------------------------------------------
    scene1_lines = [
        [("$ ", FG_GREEN, True), ("pi", FG_TEXT, True)],
        ("Pi Coding Agent v1.2.0 initialized in /home/user/workspace/app", FG_MUTED, False),
        [("Loaded extensions: ", FG_MUTED, False), ("auto-permission-system v3.8.0", FG_PURPLE, True)],
        [("Status: ", FG_MUTED, False), ("Sandbox: 🧠 Advanced Secure", FG_GREEN, True), (" (Auto Mode active: scans files & content)", FG_MUTED, False)],
        "SPACER",
        [("pi > ", FG_CYAN, True), ("Inspect configuration, verify services and deploy", FG_TEXT, False)],
        "SPACER",
        [("● ", FG_CYAN, False), ("Agent: Checking environment and database configuration...", FG_TEXT, False)],
        [("  → Calling tool: ", FG_MUTED, False), ("read(\".env\")", FG_YELLOW, True)],
    ]

    for _ in range(14):
        img = draw_terminal_base()
        draw = ImageDraw.Draw(img)
        render_lines(draw, scene1_lines)
        frames.append(img)

    # ----------------------------------------------------
    # SCENE 2: L2 Guard Intercepts .env (Ask Tier Prompt)
    # ----------------------------------------------------
    scene2_header = [
        [("$ ", FG_GREEN, True), ("pi", FG_TEXT, True)],
        [("Status: ", FG_MUTED, False), ("Sandbox: 🧠 Advanced Secure", FG_GREEN, True)],
        [("pi > ", FG_CYAN, True), ("Inspect configuration, verify services and deploy", FG_TEXT, False)],
        [("● ", FG_CYAN, False), ("Agent: Calling tool read(\".env\")...", FG_MUTED, False)],
    ]

    prompt1_title = [
        ("🔑  Let pi read your .env file?", FG_YELLOW, True),
        ("    File     ~/workspace/app/.env", FG_TEXT, False),
        ("    Why      .env files usually hold passwords and API keys", FG_MUTED, False),
        ("    Risk     the AI will see any keys in it", FG_RED, False),
        ("    Note     cannot be saved as permanent rule (secrets tier)", FG_MUTED, False),
    ]
    prompt1_options = [
        "No",
        "Yes, just this once",
        "Yes, for this session",
    ]

    for sec in [10, 9, 8]:
        for _ in range(5):
            img = draw_terminal_base()
            draw = ImageDraw.Draw(img)
            y = render_lines(draw, scene2_header)
            render_prompt_box(
                draw,
                box_y=y + 10,
                box_h=285,
                title_lines=prompt1_title,
                options=prompt1_options,
                selected_idx=0,
                default_hint=f"Default: No ({sec}s)",
            )
            frames.append(img)

    scene2_blocked = scene2_header + [
        "SPACER",
        ("🔑  Let pi read your .env file? → Selected: No", FG_MUTED, False),
        [("✗ Access blocked: ", FG_RED, True), ("denyRead matched \".env\" (Zero-Trust Guard)", FG_TEXT, False)],
        [("  Audit logged: ", FG_MUTED, False), ("~/.pi/agent/audit.log (decision: no, layer: 2)", FG_MUTED, False)],
        [("● ", FG_CYAN, False), ("Agent: .env protected. Proceeding without private variables.", FG_GREEN, False)],
    ]
    for _ in range(14):
        img = draw_terminal_base()
        draw = ImageDraw.Draw(img)
        render_lines(draw, scene2_blocked)
        frames.append(img)

    # ----------------------------------------------------
    # SCENE 3: L1 Sandbox Kernel Confinement (Bash Tampering Blocked)
    # ----------------------------------------------------
    scene3_tamper = [
        [("● ", FG_CYAN, False), ("Agent: Running setup command in bash...", FG_TEXT, False)],
        [("  → Calling tool: ", FG_MUTED, False), ("bash(\"echo 'cron' >> /etc/crontab\")", FG_YELLOW, True)],
        "SPACER",
        ("EROFS: Read-only file system, open '/etc/crontab'", FG_RED, False),
        [("✗ OS Sandbox Refusal: ", FG_RED, True), ("Layer 1 kernel sandbox blocked write outside project", FG_TEXT, False)],
        [("✓ Confinement Active: ", FG_GREEN, True), ("Bubblewrap/sandbox-exec prevented system tampering", FG_MUTED, False)],
    ]
    for _ in range(14):
        img = draw_terminal_base()
        draw = ImageDraw.Draw(img)
        render_lines(draw, scene2_blocked[-3:] + ["SPACER"] + scene3_tamper)
        frames.append(img)

    # ----------------------------------------------------
    # SCENE 4: L1 Sandbox Network Gate (Domain Ask & Countdown)
    # ----------------------------------------------------
    scene4_header = [
        [("● ", FG_CYAN, False), ("Agent: Attempting external network connection...", FG_TEXT, False)],
        [("  → Calling tool: ", FG_MUTED, False), ("bash(\"curl -s https://unknown-telemetry.io/ping\")", FG_YELLOW, True)],
    ]

    prompt2_title = [
        ("🌐  Let bash connect to unknown-telemetry.io?", FG_CYAN, True),
        ("    Site     unknown-telemetry.io", FG_TEXT, False),
        ("    Command  curl -s https://unknown-telemetry.io/ping", FG_MUTED, False),
        ("    Why      this site isn't on your allowed list yet", FG_YELLOW, False),
    ]
    prompt2_options = [
        "No",
        "Yes, just this once",
        "Yes, all in group for this session",
        "Yes, always…",
    ]

    for sec in [15, 14]:
        for _ in range(5):
            img = draw_terminal_base()
            draw = ImageDraw.Draw(img)
            render_lines(draw, scene4_header)
            render_prompt_box(
                draw,
                box_y=TERMINAL_Y + TITLEBAR_H + 90,
                box_h=290,
                title_lines=prompt2_title,
                options=prompt2_options,
                selected_idx=0,
                default_hint=f"Default: Yes, just this once ({sec}s)",
            )
            frames.append(img)

    scene4_blocked = scene4_header + [
        "SPACER",
        ("🌐  Let bash connect to unknown-telemetry.io? → Selected: No", FG_MUTED, False),
        [("✗ Network blocked: ", FG_RED, True), ("Sandbox proxy refused unapproved host (unknown-telemetry.io)", FG_TEXT, False)],
        [("✓ Zero exfiltration: ", FG_GREEN, True), ("Socket connection closed at kernel level", FG_MUTED, False)],
    ]
    for _ in range(14):
        img = draw_terminal_base()
        draw = ImageDraw.Draw(img)
        render_lines(draw, scene4_blocked)
        frames.append(img)

    # ----------------------------------------------------
    # SCENE 5: Real-Time API Key & Secret Token Redaction
    # ----------------------------------------------------
    scene5_header = [
        [("● ", FG_CYAN, False), ("Agent: Verifying upstream API endpoint...", FG_TEXT, False)],
        [("  → bash(\"node verify_service.js\")", FG_YELLOW, True)],
        ("  [info] Querying production backend endpoint...", FG_MUTED, False),
        ("  [auth] Configured key: sk-proj-a9F8d2K1m... [EXPOSED IN STDOUT]", FG_RED, False),
    ]

    prompt3_title = [
        ("⚠  Sensitive information detected: API Secret Key", FG_RED, True),
        ("    Tool     bash (node verify_service.js)", FG_TEXT, False),
        ("    Finding  sk-(?!ant-)[A-Za-z0-9_-] (score: 90 / CRITICAL)", FG_YELLOW, False),
        ("    Question Should the AI be allowed to see it?", FG_TEXT, False),
    ]
    prompt3_options = [
        "No, keep private  (recommended)",
        "Yes, allow",
    ]

    for _ in range(14):
        img = draw_terminal_base()
        draw = ImageDraw.Draw(img)
        y = render_lines(draw, scene5_header)
        render_prompt_box(
            draw,
            box_y=y + 10,
            box_h=240,
            title_lines=prompt3_title,
            options=prompt3_options,
            selected_idx=0,
            default_hint="Default: No, keep private (Esc cancels)",
        )
        frames.append(img)

    scene5_redacted = scene5_header + [
        "SPACER",
        ("⚠  Sensitive information detected → Selected: No, keep private", FG_MUTED, False),
        [("✓ Advanced Secure Active: ", FG_GREEN, True), ("Secret token masked before entering AI context", FG_TEXT, False)],
        ("  AI Context: [auth] Configured key: ***REDACTED*** (content withheld)", FG_PURPLE, False),
    ]
    for _ in range(14):
        img = draw_terminal_base()
        draw = ImageDraw.Draw(img)
        render_lines(draw, scene5_redacted)
        frames.append(img)

    # ----------------------------------------------------
    # SCENE 6: Cloud Auto Mode (Claude-Style Secure Auto Mode for Pi)
    # ----------------------------------------------------
    scene6_lines = [
        [("$ ", FG_GREEN, True), ("pi -p \"Deploy release in headless auto mode\"", FG_TEXT, True)],
        [("Mode: ", FG_MUTED, False), ("Cloud Auto Mode (sandbox.cloud.json)", FG_CYAN, True)],
        ("Auto Mode for Pi: Advanced Secure content scan prevents data breaches", FG_MUTED, False),
        "SPACER",
        [("✓  Layer 1 Sandbox:   ", FG_GREEN, True), ("OS Kernel isolation (bubblewrap/sandbox-exec) ACTIVE", FG_TEXT, False)],
        [("✓  Layer 2 Tool Guard: ", FG_GREEN, True), ("In-process read/write/edit/grep boundaries ACTIVE", FG_TEXT, False)],
        [("✓  Layer 3 Auto Secure: ", FG_GREEN, True), ("Real-time content scan & secret leak prevention ACTIVE", FG_TEXT, False)],
        [("✓  Zero Deadlocks:     ", FG_GREEN, True), ("Headless auto mode runs safely without hanging on prompts", FG_TEXT, False)],
        "SPACER",
        ("╔═══════════════════════════════════════════════════════════════════════════════════╗", FG_PURPLE, True),
        ("║       auto-permission-system: Secure Auto Mode for Pi Coding Agent                ║", FG_TEXT, True),
        ("║       Install: pi install npm:auto-permission-system                             ║", FG_CYAN, True),
        ("╚═══════════════════════════════════════════════════════════════════════════════════╝", FG_PURPLE, True),
    ]

    for _ in range(24):
        img = draw_terminal_base()
        draw = ImageDraw.Draw(img)
        render_lines(draw, scene6_lines)
        frames.append(img)

    return frames

def main():
    assets_dir = os.path.abspath("assets")
    os.makedirs(assets_dir, exist_ok=True)
    temp_dir = tempfile.mkdtemp(prefix="aps_demo_frames_")

    print(f"Generating crisp widescreen HD (1200x580) frames in {temp_dir}...")
    frames = create_frames()
    print(f"Generated {len(frames)} frames.")

    for idx, f in enumerate(frames):
        frame_path = os.path.join(temp_dir, f"frame_{idx:04d}.png")
        f.save(frame_path, "PNG")

    mp4_out = os.path.join(assets_dir, "demo.mp4")
    gif_out = os.path.join(assets_dir, "demo.gif")

    print("Encoding HD MP4 with ffmpeg (CRF 16 - visually lossless)...")
    cmd_mp4 = [
        "ffmpeg", "-y",
        "-framerate", "12",
        "-i", os.path.join(temp_dir, "frame_%04d.png"),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", "16",
        "-movflags", "+faststart",
        mp4_out
    ]
    subprocess.run(cmd_mp4, check=True)
    print(f"Saved MP4: {mp4_out}")

    print("Encoding High-Res GIF with ffmpeg (256-color palette, high quality)...")
    palette_path = os.path.join(temp_dir, "palette.png")
    cmd_palette = [
        "ffmpeg", "-y",
        "-framerate", "12",
        "-i", os.path.join(temp_dir, "frame_%04d.png"),
        "-vf", "palettegen=max_colors=256:reserve_transparent=0",
        palette_path
    ]
    subprocess.run(cmd_palette, check=True)

    cmd_gif = [
        "ffmpeg", "-y",
        "-framerate", "12",
        "-i", os.path.join(temp_dir, "frame_%04d.png"),
        "-i", palette_path,
        "-lavfi", "paletteuse=dither=bayer:bayer_scale=3",
        gif_out
    ]
    subprocess.run(cmd_gif, check=True)
    print(f"Saved GIF: {gif_out}")

    shutil.rmtree(temp_dir)
    print("Done! Widescreen HD demo generation complete.")

if __name__ == "__main__":
    main()
