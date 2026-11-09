// Runs before ElectronMain. The expected digest is compiled into this image,
// so editing Info.plist together with app.asar cannot replace the trust anchor.
// Rewriting/re-signing native code remains outside this offline boundary.
#include <CommonCrypto/CommonDigest.h>
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifndef EXPECTED_ASAR_SHA256
#error Build with the digest of the final app.asar
#endif

static void refuse(void) {
    fputs("应用归档完整性校验失败，请重新下载完整安装包。\n", stderr);
    _exit(78);
}

__attribute__((constructor)) static void verify_archive(void) {
    char executable[PATH_MAX], resolved[PATH_MAX], archive[PATH_MAX];
    uint32_t size = sizeof(executable);
    if (_NSGetExecutablePath(executable, &size) != 0 || !realpath(executable, resolved)) refuse();
    char *slash = strrchr(resolved, '/');
    if (!slash) refuse();
    *slash = '\0';
    int length = snprintf(archive, sizeof(archive), "%s/../Resources/app.asar", resolved);
    if (length < 0 || (size_t)length >= sizeof(archive)) refuse();
    FILE *source = fopen(archive, "rb");
    if (!source) refuse();
    CC_SHA256_CTX context;
    CC_SHA256_Init(&context);
    unsigned char buffer[65536], digest[CC_SHA256_DIGEST_LENGTH];
    size_t count;
    while ((count = fread(buffer, 1, sizeof(buffer), source)) != 0) CC_SHA256_Update(&context, buffer, (CC_LONG)count);
    if (ferror(source)) { fclose(source); refuse(); }
    fclose(source);
    CC_SHA256_Final(digest, &context);
    char encoded[CC_SHA256_DIGEST_LENGTH * 2 + 1];
    for (size_t index = 0; index < sizeof(digest); index++) snprintf(encoded + index * 2, 3, "%02x", digest[index]);
    if (strcmp(encoded, EXPECTED_ASAR_SHA256) != 0) refuse();
}
