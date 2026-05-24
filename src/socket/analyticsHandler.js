const EventService = require("../services/EventService");
const AnalyticsService = require("../services/AnalyticsService");
const MeetingService = require("../services/MeetingService");
const RoomState = require("../state/RoomState");

const SLIDE_LABELS = {
    "Welcome.html": "Opening Hook",
    "Slide-7.html": "Who Are We",
    "Slide-Trust.html": "Trust & Documents",
    "Slide-Portfolio.html": "Mandke Projects",
    "Slide-2.html": "Project Intro",
    "locationMapSlide1.html": "Heart of Konkan",
    "Slide-3.html": "Features Overview",
    "Slide-3-2.html": "Priority Check",
    "Slide-4.html": "Location Advantage",
    "howToReach.html": "How to Reach",
    "Slide-Ultimate.html": "The Ultimate Destination",
    "Slide-Marriott.html": "Courtyard by Marriott",
    "Slide-Helipad.html": "Mandke Helipad",
    "Slide-6.html": "Neighbourhood Ecosystem",
    "Slide-9.html": "Amenities",
    "Slide-5.html": "Selection Survey",
    "Slide-10.html": "Unit Types",
    "Slide-14.html": "Possession Timeline",
    "Slide-13.html": "Investment Opportunity",
    "Slide-Retail.html": "Wellness Hub",
    "Slide-Airbnb.html": "Stay at Guhagar",
    "Slide-18.html": "ROI Calculator",
    "Slide-Quiz.html": "Investment Quiz",
    "plotViewer.html": "Reserve your Plot",
    "Slide-BuyNow.html": "Buy Now Offers",
    "Slide-PaymentSchedule.html": "Payment Schedule",
    "Slide-Thanks.html": "Thank You",
};

function humanizeSlide(raw) {
    if (!raw) return "";
    return SLIDE_LABELS[raw] || raw.replace(/\.html$/i, "").replace(/[-_]/g, " ");
}

function cleanLogName(str) {
    if (!str) return "Visitor activity";
    // Client already sends sales-friendly text; only strip legacy noise.
    let cleaned = str
        .replace(/Successfully\s+/gi, "")
        .replace(/User started scratching[^.]*\.?/gi, "")
        .replace(/\( Scratch (Started|Complete) \)/gi, "")
        .replace(/\( Clicked \)/gi, "")
        .replace(/Clicked\s+No description/gi, "")
        .replace(/Interface\s+Element/gi, "section")
        .replace(/\(\s*No description\s*\)/gi, "")
        .replace(/["']/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!cleaned) return "Visitor activity";
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

module.exports = (io, socket) => {

    socket.on("participant-click", async (data) => {
        const slideLabel = data.slideLabel || humanizeSlide(data.slide);
        const rawName = data.customLog ||
            `Clicked ${data.tag || "item"}${data.text ? `: ${data.text}` : ""}${slideLabel ? ` (${slideLabel})` : ""}`;

        const event = {
            event_id: "client_interaction",
            name: cleanLogName(rawName),
            time: new Date(),
            duration: data.duration || 0,
            user_name: data.userName || "Client",
            user_mobile: data.userMobile || "",
            user_title: data.userTitle || "",
            slide: data.slide || "",
            slideLabel,
        };

        io.to(data.meetingId).emit("analytics-event", {
            meetingId: data.meetingId,
            event: {
                ...event,
                activity: event.name,
                type: data.duration ? "Engagement" : "Interaction",
            },
        });

        const meetingPk = RoomState.getMeetingPk(data.meetingId);
        if (meetingPk) {
            EventService.recordClick(meetingPk, event).catch(() => {});
        }
    });

    socket.on("session-ended", async (data) => {
        const uuid = data.roomId;
        if (!uuid) return;
        // Only the moderator is allowed to end the session
        if (socket.meetingRole !== "moderator") return;

        const meetingPk = RoomState.getMeetingPk(uuid);

        try {
            if (meetingPk) await AnalyticsService.summarize(meetingPk);
            await MeetingService.reset(uuid);
        } catch (e) {
            // Silently handle conclusion errors
        } finally {
            RoomState.cleanup(uuid);
        }

        io.to(uuid).emit("session-ended", data);
    });

    socket.on("participant-left", (data) => io.to(data.roomId).emit("participant-left", data));
};
