
export const parseOptionalInt = (value: unknown): number | null => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "string" && value.trim() === "") return null;

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
    return parsed;
};

export const parseOptionalBoolean = (value: unknown): boolean | null => {
    if (value === undefined || value === null || value === "") return null;

    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
        return null;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") return true;
        if (normalized === "false" || normalized === "0") return false;
    }

    return null;
};

export const parseCoordinates = (
    location: unknown,
    latitude: unknown,
    longitude: unknown,
): { latitude: number; longitude: number } | null => {
    if (location && typeof location === "object") {
        const obj = location as Record<string, unknown>;
        const latCandidate = obj.latitude ?? obj.lat;
        const lngCandidate = obj.longitude ?? obj.lng ?? obj.lon;
        const parsedLat = Number(latCandidate);
        const parsedLng = Number(lngCandidate);

        if (
            Number.isFinite(parsedLat)
            && Number.isFinite(parsedLng)
            && parsedLat >= -90
            && parsedLat <= 90
            && parsedLng >= -180
            && parsedLng <= 180
        ) {
            return { latitude: parsedLat, longitude: parsedLng };
        }
    }

    const parsedLat = Number(latitude);
    const parsedLng = Number(longitude);
    if (
        Number.isFinite(parsedLat)
        && Number.isFinite(parsedLng)
        && parsedLat >= -90
        && parsedLat <= 90
        && parsedLng >= -180
        && parsedLng <= 180
    ) {
        return { latitude: parsedLat, longitude: parsedLng };
    }

    return null;
};