# Screen Resolution Checker

A single-page web app that shows your screen and browser details, live:

- **Screen resolution:** physical pixels, logical (CSS) pixels, available area and aspect ratio
- **Browser zoom:** the current zoom level and whether the page is zoomed in or out
- **Display scaling:** OS scaling (for example Windows 125%) and device pixel ratio
- **Window and viewport:** viewport size, window size and position, scrollbar width, pinch zoom
- **Display capabilities:** refresh rate, color depth, color gamut, HDR, orientation
- **All monitors:** resolution and scaling of every connected screen (Chrome and Edge, needs permission)
- **System:** browser, OS, CPU threads, memory, GPU, input type and accessibility preferences
- **Export:** copy a text report or download it as JSON

The app is plain HTML, CSS and JavaScript with no build step and no dependencies. Nothing leaves the browser.

## Run locally

Open `index.html` in a browser.

## Host for free on GitHub Pages

1. Create a new **public** repository on GitHub, for example `screen-resolution-checker`.
2. Push these files to it:

   ```bash
   git init
   git add .
   git commit -m "Screen resolution checker"
   git branch -M main
   git remote add origin https://github.com/<your-username>/screen-resolution-checker.git
   git push -u origin main
   ```

3. On GitHub, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to *Deploy from a branch*. Then pick branch `main` and folder `/ (root)` and click **Save**.
5. After a minute or two, the site is live at
   `https://<your-username>.github.io/screen-resolution-checker/`

Each push to `main` redeploys the site automatically.

## How zoom detection works

Browsers don't expose the zoom level directly, so the app infers it:

- **Chrome, Edge, Opera, Brave and Safari:** compares the window's outer width (in screen pixels) with the viewport width (in zoomed CSS pixels), allowing for the window frame. This is accurate unless DevTools or a side panel is docked to the left or right.
- **Firefox:** splits `devicePixelRatio` into display scaling × zoom. The result is labelled *Estimated*, because some combinations are ambiguous. For example, 150% scaling at 100% zoom looks the same as 125% scaling at 120% zoom.
- **Phones and tablets:** browser zoom isn't detectable.

Physical resolution is the logical resolution multiplied by the display scaling. On macOS this is the HiDPI rendering resolution, which can differ from the panel's native pixel count.
