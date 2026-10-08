# Screen Resolution Checker

A single-page web app that shows four live summary cards:

- **Screen resolution:** physical pixels, aspect ratio and logical (CSS) pixels
- **Browser zoom:** the current zoom level and whether the page is zoomed in or out
- **Display scaling:** OS scaling (for example Windows 125%) and device pixel ratio
- **Browser viewport:** viewport size and window size

With more than one monitor connected, a bar below the cards shows which monitor the window is on:

- **Without permission:** the window's position on the desktop shows whether this is the primary or a secondary monitor, and which side of the primary it's on.
- **With permission:** in Chrome and Edge, clicking **Identify all monitors** asks for the browser's *window management* permission. The page then shows "Monitor 2 of 3" and a diagram of the monitor layout. Monitors are numbered left to right, and the current one is highlighted.

The **Download JSON** button saves a full report. Besides the summary, it includes:

- **Monitor:** whether several monitors are connected, which one this window is on, whether it's the primary, and where it sits relative to the primary
- **All monitors:** when permission is granted, the resolution, scaling and position of each monitor, with the current one marked

- **Display:** available area, refresh rate, color depth, color gamut, HDR, orientation, multiple monitors
- **Browser window and zoom:** zoom detection method, viewport without scrollbars, window position, scrollbar width, pinch zoom, page size
- **Window on screen:** where the window sits on the screen, how much of the screen it covers, whether it's maximized
- **Browser and device:** browser name and version, rendering engine, operating system, primary input type

### Privacy

The report leaves out anything that could identify or locate a person, or that is commonly used to fingerprint a browser:

- the full user agent string
- language and time zone
- CPU, memory, GPU and device model
- accessibility settings, such as reduced motion, contrast and forced colors, which can reveal health information
- the page address, which can contain a local file path or username

Nothing is sent anywhere. The report is created in the browser and saved only when the user clicks **Download JSON**.

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
