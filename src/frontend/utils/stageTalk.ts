import { get } from "svelte/store"
import { STAGE } from "../../types/Channels"
import type { OutSlide } from "../../types/Show"
import type { ClientMessage } from "../../types/Socket"
import { clone } from "../components/helpers/array"
import { getBase64Path } from "../components/helpers/media"
import { getActiveOutputs } from "../components/helpers/output"
import { getGroupName, getLayoutRef } from "../components/helpers/show"
import { _show } from "../components/helpers/shows"
import { getCustomStageLabel } from "../components/stage/stage"
import { dictionary, events, groups, media, outputs, outputSlideCache, previewBuffers, stageShows, timeFormat, timers, variables, videosData, videosTime } from "../stores"
import { connections } from "./../stores"
import { send } from "./request"
import { arrayToObject, filterObjectArray, sendData } from "./sendData"

// WIP loading different paths, might cause returned base64 to be different than it should if previous thumbnail finishes after
export async function sendBackgroundToStage(outputId, updater = get(outputs), returnPath = false) {
    let currentOutput = updater[outputId]?.out
    let next = await getNextBackground(currentOutput?.slide || null, returnPath)
    let path = currentOutput?.background?.path || ""
    if (typeof path !== "string") path = ""

    if (returnPath) {
        return clone({ path, mediaStyle: get(media)[path] || {}, next })
    }

    if (!path && !next.path?.length) {
        if (!returnPath) send(STAGE, ["BACKGROUND"], { path: "" })
        return
    }

    let base64path = await getBase64Path(path)

    let bg = clone({ path: base64path, filePath: path, mediaStyle: get(media)[path] || {}, next })

    if (returnPath) return bg

    send(STAGE, ["BACKGROUND"], bg)
    return
}

async function getNextBackground(currentOutputSlide: OutSlide | null, returnPath = false) {
    if (!currentOutputSlide?.id) return {}

    let showRef = _show(currentOutputSlide.id).layouts([currentOutputSlide.layout]).ref()[0]
    if (!showRef) return {}

    // GET CORRECT INDEX OFFSET, EXCLUDING DISABLED SLIDES
    const slideOffset = 1
    let layoutOffset = currentOutputSlide.index || 0
    let offsetFromCurrentExcludingDisabled = 0
    while (offsetFromCurrentExcludingDisabled < slideOffset && layoutOffset <= showRef.length) {
        layoutOffset++
        if (!showRef[layoutOffset]?.data?.disabled) offsetFromCurrentExcludingDisabled++
    }
    const slideIndex = layoutOffset

    let nextLayout = showRef[slideIndex]
    if (!nextLayout) return {}

    let bgId = nextLayout.data.background || ""
    let path = _show(currentOutputSlide.id).media([bgId]).get()?.[0]?.path || ""
    if (typeof path !== "string") path = ""

    if (returnPath) return { path, mediaStyle: get(media)[path] || {} }

    let base64path = await getBase64Path(path)

    return { path: base64path, filePath: path, mediaStyle: get(media)[path] || {} }
}

export const receiveSTAGE = {
    SHOWS: (msg: ClientMessage) => {
        msg.data = turnIntoBoolean(
            filterObjectArray(get(stageShows), ["disabled", "name", "password"]).filter((a: any) => !a.disabled),
            "password"
        )
        return msg
    },
    SHOW: (msg: ClientMessage) => {
        if (!msg.id) return { id: msg.id, channel: "ERROR", data: "missingID" }

        let show = get(stageShows)[msg.data.id]
        if (!show || show.disabled) return { id: msg.id, channel: "ERROR", data: "noShow" }
        if (show.password.length && show.password !== msg.data.password) return { id: msg.id, channel: "ERROR", data: "wrongPass" }

        // connection successfull
        connections.update((a) => {
            if (!a.STAGE) a.STAGE = {}
            if (!a.STAGE[msg.id!]) a.STAGE[msg.id!] = {}
            a.STAGE[msg.id!].active = msg.data.id
            return a
        })
        show = arrayToObject(filterObjectArray(get(stageShows), ["disabled", "name", "settings", "items"]))[msg.data.id]

        // add labels
        Object.keys(show.items).map((itemId) => {
            show.items[itemId].label = getCustomStageLabel(itemId)
        })

        // if (show.disabled) return { id: msg.id, channel: "ERROR", data: "noShow" }

        msg.data = show
        sendData(STAGE, { channel: "SLIDES", data: [] })

        // initial
        window.api.send(STAGE, { id: msg.id, channel: "TIMERS", data: get(timers) })
        window.api.send(STAGE, { id: msg.id, channel: "EVENTS", data: get(events) })
        window.api.send(STAGE, { id: msg.id, channel: "VARIABLES", data: get(variables) })
        send(STAGE, ["DATA"], { timeFormat: get(timeFormat) })
        return msg
    },
    SLIDES: (msg: ClientMessage) => {
        // TODO: rework how stage talk works!! (I should send to to each individual connected stage with it's id!)
        let stageId = msg.data?.id
        if (!stageId && Object.keys(get(connections).STAGE || {}).length === 1) stageId = (Object.values(get(connections).STAGE)[0] as any).active
        let show = get(stageShows)[stageId] || {}
        let outputId = show.settings?.output || getActiveOutputs()[0]
        let currentOutput = get(outputs)[outputId]
        let outSlide = currentOutput?.out?.slide || null
        let outCached: any = get(outputSlideCache)[outputId]
        let out: any = outSlide || outCached
        msg.data = []

        if (!out) {
            // next slide image thumbnail will remain if not cleared here
            setTimeout(() => send(STAGE, ["BACKGROUND"], { path: "" }), 500)
            return msg
        }

        // scripture
        if (out.id === "temp") {
            msg.data = [{ items: out.tempItems }]
            return msg
        }

        let ref = _show(out.id).layouts([out.layout]).ref()[0]
        let slides: any = _show(out.id).get()?.slides

        if (!ref?.[out.index!]) return
        msg.data = [{ ...slides[ref[out.index!].id], showId: out.id }]

        let nextIndex = out.index! + 1
        if (ref[nextIndex]) {
            while (nextIndex < ref.length && ref[nextIndex].data.disabled === true) nextIndex++

            if (nextIndex < ref.length && !ref[nextIndex].data.disabled) msg.data.push({ ...slides[ref[nextIndex].id], showId: out.id })
            else msg.data.push(null)
        } else msg.data.push(null)

        // don't show current slide if just in cache
        if (!outSlide) msg.data[0] = null

        sendBackgroundToStage(outputId)

        return msg
    },
    REQUEST_PROGRESS: (msg: ClientMessage) => {
        let outputId = msg.data.outputId
        if (!outputId) outputId = getActiveOutputs(get(outputs), false, true, true)[0]
        if (!outputId) return

        let currentSlideOut = get(outputs)[outputId]?.out?.slide || null
        let currentShowId = currentSlideOut?.id || ""
        let currentShowSlide = currentSlideOut?.index ?? -1
        let currentLayoutRef = getLayoutRef(currentShowId)
        let currentShowSlides = _show(currentShowId).get("slides") || {}
        let slidesLength = currentLayoutRef.length || 0

        // get custom group names
        let layoutGroups = currentLayoutRef.map((a) => {
            let ref = a.parent || a
            let slide = currentShowSlides[ref.id]
            if (!slide) return { name: "—" }

            if (a.data.disabled || slide.group?.startsWith("~")) return { hide: true }

            let group = slide.group || "—"
            if (slide.globalGroup && get(groups)[slide.globalGroup]) {
                group = get(groups)[slide.globalGroup].default ? get(dictionary).groups?.[get(groups)[slide.globalGroup].name] : get(groups)[slide.globalGroup].name
            }

            if (typeof group !== "string") group = ""
            let name = getGroupName({ show: _show(currentShowId).get(), showId: currentShowId }, ref.id, group, ref.layoutIndex)?.replace(/ *\([^)]*\) */g, "")
            let oneLetterName = getGroupName({ show: _show(currentShowId).get(), showId: currentShowId }, ref.id, group[0].toUpperCase(), ref.layoutIndex)?.replace(/ *\([^)]*\) */g, "")
            return { name: name || "—", oneLetterName: (oneLetterName || "—").replace(" ", ""), index: ref.layoutIndex, child: a.type === "child" ? (currentLayoutRef[ref.layoutIndex]?.children || []).findIndex((id) => id === a.id) + 1 : 0 }
        })

        msg.data.progress = { currentShowSlide, slidesLength, layoutGroups }

        return msg
    },
    REQUEST_STREAM: (msg: ClientMessage) => {
        let id = msg.data.outputId
        if (!id) id = getActiveOutputs(get(outputs), false, true, true)[0]
        if (msg.data.alpha && get(outputs)[id].keyOutput) id = get(outputs)[id].keyOutput

        if (!id) return

        msg.data.stream = get(previewBuffers)[id]

        return msg
    },
    REQUEST_VIDEO_DATA: (msg: ClientMessage) => {
        if (!msg.data) msg.data = {}

        // WIP don't know the outputId
        // let id = msg.data.outputId
        let outputId = getActiveOutputs(get(outputs), false, true, true)[0]
        if (!outputId) return

        msg.data.data = get(videosData)[outputId]
        msg.data.time = get(videosTime)[outputId]

        return msg
    },
    // TODO: send data!
    // case "SHOW":
    //   data = getStageShow(message.data)
    //   break
    // case "BACKGROUND":
    //   data = getOutBackground()
    //   break
    // case "SLIDE":
    //   data = getOutSlide()
    //   break
    // case "OVERLAYS":
    //   data = getOutOverlays()
    //   break
}

function turnIntoBoolean(array: any[], key: string) {
    return array.map((a) => {
        a[key] = a[key].length ? true : false
        return a
    })
}
