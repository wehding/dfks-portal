export const ADMIN_CONTRACT_UPLOAD_ACCEPT = ".pdf,.doc,.docx,.txt"

const ADMIN_CONTRACT_UPLOAD_EXTENSIONS = ADMIN_CONTRACT_UPLOAD_ACCEPT.split(",")

export function isSupportedAdminContractFile(fileName: string) {
    const lowerName = fileName.toLowerCase()
    return ADMIN_CONTRACT_UPLOAD_EXTENSIONS.some(extension => lowerName.endsWith(extension))
}
