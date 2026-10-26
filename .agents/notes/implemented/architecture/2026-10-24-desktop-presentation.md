# Agent Note: Desktop-owned instance presentation

Status: implemented

English | [中文](2026-10-24-desktop-presentation.zh.md)

## Problem

Software wallpaper settings cannot create a continuous desktop canvas while embedded clients paint opaque application backgrounds. Namespace synchronization alone also makes visual customization depend on the remote server's settings schema. Separate settings shells give users competing entry points for software preferences.

## Decision

The desktop manager paints the wallpaper and its optional mask once. Instance WebContentsViews have transparent backgrounds. A main-process-owned author-origin stylesheet clears the embedded document canvas and supplies validated region and foreground colors through important DSH semantic tokens. Instance reloads reinstall the stylesheet, software edits replace it, and view destruction discards its key. Author origin permits removal in Electron 44, whose user-origin styles survived removal in the desktop probe. Presentation applies before settings RPC and remains available when that RPC fails. The sidebar column paints its background once; the composer fade accepts a transparent desktop fill. DSH retains workspace, conversation, input, onboarding, and plugin behavior.

Instance preloads expose only a carrier marker and a request to open software settings. The main process authenticates the owning instance's main frame and forwards that request to the existing shell settings tab. Browser clients retain their own settings panel. Automatic onboarding and feature-directed settings sections remain instance-owned. Remote instances retain their own client resources; matching semantic tokens and the settings navigation integration determine how much presentation they support.

This partially supersedes the theme-setting-only presentation choice in the [instance-manager decision](2026-09-16-desktop-instance-manager.md). That record remains active because it owns independent process, isolation, credentials, and software-settings decisions. Validated portable image storage and revision-fenced settings synchronization remain applicable; the desktop stylesheet is the visual authority inside the application.

Wallpaper mode gives each shell region one background fill. Nested settings cards and instance rows stay transparent because repeating an 80% fill would raise the effective opacity to 96%. The active tab also shares its parent strip; its accent underline identifies selection. Welcome cards paint their own content fill because they have no filled parent. Hover tints remain translucent, while menus and dialogs keep solid fills for readable overlapping content.

Unsaved appearance drafts belong to the desktop main process until saved or canceled. The shell forwards validated previews through its manager-only IPC, and each instance's existing synchronization queue serializes stylesheet replacements. Preview requests do not write software settings or call backend settings APIs. New and reloaded instance views use the current draft; cancel and manager reload restore saved presentation. This keeps the wallpaper visible through the conversation during preview without persisting an unfinished choice.

The built-in appearance adapter belongs to the shell distribution, independently of kernel release files and instance plugin graphs. In wallpaper mode it clears the legacy base-background token and nested page fills, while named `root`, `main`, and `sidebar` slots identify the columns that paint each region once. Desktop-aware conversation roots also remain transparent over their column. Floating menus and dialogs receive solid fill tokens locally. Slot selectors accommodate deferred page mounts and CSS Module rebuilds without generated class names or mutation observers.

The shell distributes its motion plugin as one stylesheet shared by the manager and injected instance views. `appearance.motionEnabled` defaults to true, including when absent from older software settings, and rejects non-boolean values. The Appearance switch saves immediately; existing view queues replace styles before settings RPC, while subsequent loads use the saved choice. A native motion field receives the choice only when the instance publishes it. A CSS media query admits added motion only when the system permits it. Selectors target semantic controls and floating surfaces, leaving transcript content and scroll behavior alone. Entrance animations release their translation after completion so they do not retain a containing block for positioned descendants. Client-native animations remain client-owned when the plugin is disabled.

Shared settings resolve against each instance's serialized schema, independently by namespace and field. The same mapping supplies the manager's mutation allowlist. Provider and model form an optional pair; blank fields preserve instance selection. Reasoning targets default-model settings when published, otherwise the DeepSeek provider field. Enum options and numeric limits inform controls and preflight validation; missing fields remain explicit unsupported capabilities. Software choices stay authoritative across local and SSH instances, without importing instance values. Kernel-version heuristics cannot describe independently composed plugins, so the presence of one namespace never removes another namespace's supported controls.

## Alternatives considered

**Only synchronize theme settings.** This leaves opaque client layers and makes desktop appearance depend on a backend schema accepting personalization.

**Rebuild every client view in Electron.** This duplicates workspace and conversation behavior and cannot preserve a remote server's own feature UI.

**Give embedded pages the manager bridge.** Settings navigation needs no process, credential, or instance mutation capabilities. A separate authenticated request keeps those privileges in the shell.

**Install an appearance plugin into every kernel profile.** Kernel-specific client loading and package compatibility would become prerequisites for shell wallpaper. Shell-owned CSS injection keeps local and SSH presentation independent of backend plugin installation and kernel replacement.

**Observe every DOM mutation to animate new content.** Streaming replies and frequently rebuilt controls would repeatedly animate. Semantic CSS selectors cover late mounts without observers, transcript subscriptions, or session events.

## Consequences

Semantic token names and named slot ancestry form a presentation dependency on embedded clients. Unknown remote components can retain opaque surfaces, and older clients without the navigation integration retain their own settings trigger. Settings RPC failures stay visible independently of presentation. Raster images remain shell-owned for painting, so masking and cropping are continuous across the title strip and instance viewport.

Focused tests cover navigation authorization, reload installation, and rejected settings RPC. The Electron smoke displays the actual conversation, checks a composited wallpaper pixel, captures the visible window, and follows the instance settings trigger to the shell tab. These checks require no model credentials.

Headless Chromium regressions exercise released and desktop-aware layout fixtures, late-mounted internal pages, one fill per column, solid floating surfaces, light and dark colors, zero and full panel opacity, and stylesheet removal. These fixtures verify CSS composition; they do not replace an acceptance check against a newly released kernel's actual slot ancestry.

Motion regressions cover older preference files, restart persistence, invalid IPC and disk values, the localized settings snapshot, existing-view replacement, reloads, reduced motion, stylesheet removal, unanimated transcript content, and translation cleanup. The same stylesheet ships with the manager and instances, so remote clients need compatible HTML semantics rather than a new kernel plugin.

Settings regressions exercise coexisting namespace generations, revision-fenced dispatch, schema limits, optional model selection, read-only providers, missing fields, unchanged values, and published native motion. The localized control snapshot records the shared settings entry points. These checks use owned schemas and fixture transports; live kernel acceptance remains separate.
