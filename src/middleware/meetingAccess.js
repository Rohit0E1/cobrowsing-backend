const MeetingService = require("../services/MeetingService");
const { scopeOwner } = require("./auth");

const requireTenantMeeting = async (req, res, next) => {
    try {
        const meeting = await MeetingService.getWithModerator(req.params.uuid);
        if (!meeting || meeting.tenant_id !== req.user.tenantId || !(await MeetingService.isVisibleTo(meeting.id, scopeOwner(req.user)))) {
            return res.status(404).json({ error: "Not found" });
        }
        req.meeting = meeting;
        next();
    } catch (err) {
        res.status(500).json({ error: "Fetch error" });
    }
};

module.exports = { requireTenantMeeting };
