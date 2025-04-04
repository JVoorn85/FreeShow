<script lang="ts">
    import { io } from "socket.io-client"
    import Slide from "./components/Slide.svelte"
    import { activeTimers, events, progressData, timeFormat, timers, variables } from "./store"
    import Center from "../common/components/Center.svelte"
    import Button from "../common/components/Button.svelte"
    import Icon from "../common/components/Icon.svelte"

    // TODO: translate
    const lang: any = {
        empty: {
            shows: "No shows",
        },
        // edit: {
        //     transpose: "Transpose",
        // },
        error: {
            wrongPass: "Wrong password!",
            missingID: "Something went wrong, try again!",
            noShow: "Could not find active show!",
            overLimit: "Maximum connections reached!",
        },
    }

    let socket = io()

    socket.on("connect", () => {
        id = socket.id || ""
        console.log(id)
        socket.emit("STAGE", { id, channel: "SHOWS" })
    })

    // select stage by link query
    const urlParams = new URLSearchParams(window.location.search)
    const nameQuery = urlParams.get("name")
    const idQuery = urlParams.get("id")

    let id: string = ""
    let shows: any = null
    let showRef: any = null
    let show: any = null
    let slides: any[] = []
    let background: any = {}

    let input: any = null
    let password: string = ""
    const submit = () => (showRef = { id: input.id, password })

    // local storage
    let remember: boolean = false
    if (localStorage.show) {
        let password = undefined
        if (localStorage.password) {
            remember = true
            password = localStorage.password
        }
        showRef = { id: localStorage.show, password }
    }

    // error
    let errors: string[] = []
    const setError = (err: string) => {
        if (!errors.includes(err)) {
            errors = [...errors, err]
            setTimeout(() => (errors = errors.slice(1, errors.length)), 2000)
        }
    }

    let stream: any = {}

    socket.on("STAGE", (msg) => {
        if (msg.channel !== "BACKGROUND") console.log(msg)
        switch (msg.channel) {
            case "ERROR":
                setError(lang.error[msg.data])
                input = null
                showRef = null
                delete localStorage.password
                delete localStorage.show
                break
            case "SWITCH":
                if (show?.password) input = show
                else showRef = { id: msg.data.id }
                break
            case "DATA":
                if (msg.data.timeFormat) timeFormat.set(msg.data.timeFormat)
                break
            case "SHOWS":
                input = null
                if (msg.data.length === 1) {
                    if (msg.data[0].password) {
                        input = msg.data[0]
                        shows = msg.data
                        showRef = null
                    } else showRef = { id: msg.data[0].id }
                } else {
                    shows = msg.data

                    if (idQuery) showRef = { id: idQuery }
                    else if (nameQuery) {
                        let matchingLayout = shows.find((a: any) => a.name.replaceAll(" ", "").toLowerCase() === nameQuery.toLowerCase())
                        if (matchingLayout) showRef = { id: matchingLayout.id }
                    }

                    if (showRef) {
                        let index = shows.findIndex((s: any) => s.id === showRef.id)
                        if (index < 0 || shows[index].disabled === true) showRef = null
                    }
                }
                break
            case "SHOW":
                console.log(msg.data)

                if (msg.data === null) showRef = null
                else if (!showRef) {
                    // show = null
                    // localStorage.show = null
                } else if (msg.data.disabled === true) {
                    if (showRef.id === msg.data.id) showRef = null
                    shows = shows.filter((s: any) => s.id === msg.data.id)
                } else {
                    show = msg.data
                    if (remember || !password.length) localStorage.show = showRef.id
                    if (remember && password.length) localStorage.password = password
                }

                // localStorage.show = showRef
                break
            case "SLIDES":
                slides = msg.data

                // SlideProgress item
                socket.emit("STAGE", { id, channel: "REQUEST_PROGRESS", data: { outputId: msg.data.outputId } })
                break
            case "BACKGROUND":
                background = msg.data
                break

            // data
            case "EVENTS":
                events.set(msg.data)
                break
            case "TIMERS":
                timers.set(msg.data)
                break
            case "VARIABLES":
                variables.set(msg.data)
                break
            case "ACTIVE_TIMERS":
                activeTimers.set(msg.data)
                break
            case "REQUEST_PROGRESS":
                progressData.set(msg.data)
                break
            case "REQUEST_STREAM":
                stream[msg.data.alpha ? "alpha" : "default"] = msg.data.stream
                setTimeout(() => {
                    socket.emit("STAGE", { id, channel: "REQUEST_STREAM", data: { outputId: msg.data.outputId, alpha: msg.data.alpha } })
                }, 300)
                break

            default:
                break
        }
    })

    $: {
        if (id && showRef !== null) socket.emit("STAGE", { id, channel: "SHOW", data: showRef })
    }

    let clicked: boolean = false
    const click = (e: any) => {
        if (e.target.closest(".clicked")) return

        // wait for actions to maybe open
        setTimeout(() => {
            if (document.querySelector(".actions")?.children?.length) return

            clicked = !clicked
        })
    }

    let timeout: NodeJS.Timeout | null = null
    $: {
        if (clicked) {
            if (timeout !== null) clearTimeout(timeout)
            timeout = setTimeout(() => {
                clicked = false
                timeout = null
            }, 3000)
        }
    }

    let isFullscreen: boolean = false
    function toggleFullscreen() {
        var doc = window.document
        var docElem = doc.documentElement

        if (!doc.fullscreenElement) {
            docElem.requestFullscreen.call(docElem)
            isFullscreen = true
        } else {
            doc.exitFullscreen.call(doc)
            isFullscreen = false
        }
    }
</script>

<svelte:window on:click={click} />

{#if errors.length}
    <div class="error">
        {#each errors as error}
            <span>{error}</span>
        {/each}
    </div>
{/if}

{#if showRef === null && shows !== null}
    {#if input !== null}
        <div class="center">
            <div class="card">
                <h3 style="text-align: center;">{input.name}</h3>
                <input
                    class="input"
                    style="text-align: center;"
                    type="password"
                    placeholder="Password"
                    on:keydown={(e) => {
                        if (e.key === "Enter") submit()
                    }}
                    bind:value={password}
                />
                <Button on:click={submit} style="color: var(--secondary);" bold dark center>Submit</Button>
                <span style="text-align: center;"><input type="checkbox" bind:checked={remember} /><span style="opacity: 0.6;padding-left: 10px;">Remember me</span></span>
            </div>
        </div>
        <div class="clicked" style="background-color: var(--primary-darker);">
            <Button
                on:click={() => {
                    input = null
                    showRef = null
                }}
                style="width: 100%;"
                center
            >
                <Icon id="home" />
            </Button>
        </div>
    {:else if shows.length}
        <div class="center" style="padding: 20px;flex-direction: column;">
            <h1>StageShow</h1>
            <span style="overflow: auto;width: 100%;">
                {#each shows as show}
                    <Button
                        style="width: 100%;justify-content: center;"
                        on:click={() => {
                            show.password ? (input = show) : (showRef = { id: show.id })
                        }}
                    >
                        {show.name || "—"}
                        {#if show.password}
                            <Icon id="locked" style="padding-left: 10px;" />
                        {/if}
                    </Button>
                {/each}
            </span>
        </div>
    {:else}
        <Center faded>
            {lang.empty.shows}
        </Center>
    {/if}
{:else if show}
    <!-- on click -->
    <!-- <div class="main">
    {show.name}
    home
  </div> -->
    <Slide {show} {slides} socketId={id} {socket} {stream} {background} />
    {#if clicked}
        <div class="clicked">
            <h5 style="text-align: center;">{show.name || "—"}</h5>
            <div style="display: flex;gap: 10px;">
                <Button
                    on:click={() => {
                        if (shows?.length < 2) return

                        delete localStorage.password
                        delete localStorage.show
                        input = null
                        showRef = null
                    }}
                    style="flex: 1;"
                    center
                >
                    <Icon id="home" />
                </Button>
                <Button on:click={toggleFullscreen} center>
                    <Icon id={isFullscreen ? "exitFullscreen" : "fullscreen"} />
                </Button>
            </div>
        </div>
    {/if}
{:else}
    <Center>Loading...</Center>
{/if}

<style>
    /* @font-face {
    font-family: "CMGSans";
    src: url("./fonts/CMGSans-Regular.ttf");
  }
  @font-face {
    font-family: "CMGSans";
    src: url("./fonts/CMGSans-Bold.ttf");
    font-weight: bold;
  }
  @font-face {
    font-family: "CMGSans";
    src: url("./fonts/CMGSans-Italic.ttf");
    font-style: italic;
  }
  @font-face {
    font-family: "CMGSans";
    src: url("./fonts/CMGSans-BoldItalic.ttf");
    font-weight: bold;
    font-style: italic;
  } */

    :global(*) {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        user-select: none;

        outline-offset: -4px;
        outline-color: var(--secondary);
    }

    :global(html) {
        height: 100%;
    }

    :global(body) {
        background-color: var(--primary);
        color: var(--text);
        /* transition: background-color 0.5s; */

        font-family: system-ui;
        font-size: 1.5em;

        height: 100%;

        /* width: 100vw;
  height: 100vh; */
    }

    :root {
        --primary: #292c36;
        --primary-lighter: #363945;
        --primary-darker: #191923;
        --primary-darkest: #12121c;
        --text: #f0f0ff;
        --textInvert: #131313;
        --secondary: #f0008c;
        --secondary-opacity: rgba(240, 0, 140, 0.5);
        --secondary-text: #f0f0ff;

        --hover: rgb(255 255 255 / 0.05);
        --focus: rgb(255 255 255 / 0.1);
        /* --active: rgb(230 52 156 / .8); */

        /* --navigation-width: 18vw; */
        --navigation-width: 300px;
    }

    .error {
        color: red;
        position: absolute;
        margin: 10px;
        padding: 10px;
        width: calc(100% - 20px);
        text-align: center;
        background-color: var(--primary-darker);
        display: flex;
        flex-direction: column;
    }

    .center {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 20px;
        width: 100%;
    }

    h1 {
        color: var(--secondary);
        text-align: center;
        padding-bottom: 20px;
    }

    .input {
        background-color: rgb(0 0 0 / 0.2);
        color: var(--text);
        /* font-family: inherit; */
        padding: 10px 18px;
        border: none;
        font-size: inherit;
    }
    .input:active,
    .input:focus {
        outline: 2px solid var(--secondary);
        /* background-color: var(--secondary-opacity); */
    }
    .input::placeholder {
        color: inherit;
        opacity: 0.4;
    }

    .clicked {
        position: absolute;
        bottom: 0;
        left: 0;
        width: calc(100% - 20px);
        margin: 10px;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background-color: var(--primary);
    }
</style>
