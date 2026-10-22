# ==============================================================================
# MODULE DOCKERFILE
# This file is not meant to be built standalone. It is consumed by the
# docker-bake.hcl files in the parent monorepos (MobileEditors).
#
# The engine for the host (Linux), with its check tool eo-render, for the
# engine tests and the co-editing check. The apps build the engine themselves
# (editors-android's JNI binding compiles these sources), so there is no stage
# for them here.
#
# REQUIRED CONTEXTS:
# - core-host: core's desktop build (core/.docker/core.bake.Dockerfile, target
#   core, PRODUCT=desktop): its build image with the libraries and tools in
#   /package/bin and /package/tools, and core's sources in /core
# - sdkjs-native: the files the engine loads (sdkjs/.docker/sdkjs.bake.Dockerfile)
# Files from the main context (the monorepo): editors-engine, core-fonts and
# document-templates (the PDF editor's blank document; the tests' samples).
#
# Stages:
# - engine-host: the runtime directory (/package/bin: core's libraries and x2t,
#   sdkjs, fonts) and /engine/eo-render, e.g. for the co-editing check:
#     docker run -i -e EO_REPL=1 <image> eo-render /package/bin <document> <out dir> 1
# - engine-tests: tests/run.sh's log (tests.log), its result (result: 0 for
#   success, kept also when tests fail) and the files the tests saved
# ==============================================================================

#### ENGINE FOR THE HOST ####
FROM core-host AS engine-host

    ENV RUNTIME=/package/bin
    ENV LD_LIBRARY_PATH=/package/bin
    ENV PATH=/engine:${PATH}

    # Runtime: sdkjs, the font index of core-fonts, the PDF editor's blank document
    # and DoctRenderer.config (core's renderer loads these scripts before sdkjs)
    COPY --from=sdkjs-native / ${RUNTIME}/sdkjs
    COPY core-fonts /core-fonts
    COPY document-templates/new/en-US/new.docx ${RUNTIME}/empty/new.docx
    RUN mkdir -p ${RUNTIME}/fonts && \
        /package/tools/allfontsgen --input=/core-fonts \
            --allfonts=${RUNTIME}/fonts/AllFonts.js --selection=${RUNTIME}/fonts/font_selection.bin && \
        printf '%s\n' '<Settings>' \
            '<file>./sdkjs/common/Native/native.js</file>' \
            '<file>./sdkjs/common/Native/jquery_native.js</file>' \
            '<file>./sdkjs/vendor/xregexp-all-min.js</file>' \
            '<allfonts>./fonts/AllFonts.js</allfonts>' \
            '<sdkjs>./sdkjs</sdkjs>' \
            '</Settings>' > ${RUNTIME}/DoctRenderer.config && \
        chmod -R a+w ${RUNTIME}/sdkjs/slide/themes  # designs are converted there (also as another user)

    COPY editors-engine /editors-engine
    RUN --mount=type=cache,id=editors-engine-host,target=/build-cache \
        cmake -S /editors-engine -B /build-cache/engine -G Ninja -DCMAKE_BUILD_TYPE=Release \
            -DCORE_SOURCE_DIR=/core -DCORE_LIBS_DIR=${RUNTIME} -DEO_ENGINE_TOOLS=ON && \
        cmake --build /build-cache/engine && \
        mkdir -p /engine && cp /build-cache/engine/eo-render /engine/

#### ENGINE TESTS ####
FROM engine-host AS engine-tests-run

    # The tests name their documents relative to the monorepo
    WORKDIR /work
    COPY document-templates/sample document-templates/sample
    RUN mkdir -p /out && \
        { OUT_DIR=/out/files /editors-engine/tests/run.sh /engine/eo-render ${RUNTIME} \
            > /out/tests.log 2>&1; echo $? > /out/result; } && \
        cat /out/tests.log

FROM scratch AS engine-tests
    COPY --from=engine-tests-run /out/ /
