# Euro-Office editor engine: sdkjs in core's doctrenderer (V8), page tiles via
# core's graphics engine. Builds against core's headers and its prebuilt
# libraries for the target platform:
#
#   Android: the libeditors Gradle module, with the core-android libraries
#   Desktop: cmake -S engine -B build -DCORE_SOURCE_DIR=... -DCORE_LIBS_DIR=... -DEO_ENGINE_TOOLS=ON
cmake_minimum_required(VERSION 3.22)
project(eo_editors_engine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CORE_SOURCE_DIR "" CACHE PATH "core checkout (for its headers)")
set(CORE_LIBS_DIR "" CACHE PATH "core libraries built for the target platform")
option(EO_ENGINE_TOOLS "Build the desktop check tools" OFF)

if(NOT EXISTS "${CORE_SOURCE_DIR}/DesktopEditor/doctrenderer/docbuilder.h")
    message(FATAL_ERROR "Set CORE_SOURCE_DIR to the core checkout")
endif()

# engine.js as a C++ string
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS src/engine.js)
file(READ src/engine.js ENGINE_JS)
configure_file(src/engine_js.h.in engine_js.h @ONLY)

# Prebuilt core libraries, linked by path. On Android they are packaged by
# core's libx2t module, so they must not be CMake targets here as well.
set(CORE_LIBS_PATH "${CORE_LIBS_DIR}")
if(ANDROID)
    set(CORE_LIBS_PATH "${CORE_LIBS_DIR}/${ANDROID_ABI}")
endif()
set(CORE_LIBRARIES doctrenderer graphics kernel UnicodeConverter)
if(ANDROID)
    # X2T_Convert, for converting in-process (see Document.cpp)
    list(APPEND CORE_LIBRARIES x2t)
endif()
set(CORE_LIBRARY_FILES "")
foreach(lib ${CORE_LIBRARIES})
    list(APPEND CORE_LIBRARY_FILES "${CORE_LIBS_PATH}/lib${lib}.so")
endforeach()

add_library(eoengine SHARED src/Document.cpp)
target_include_directories(eoengine
    PUBLIC src
    PRIVATE "${CORE_SOURCE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}"
)
# Platform defines core's headers expect
target_compile_definitions(eoengine PRIVATE LINUX _LINUX)
target_link_libraries(eoengine PRIVATE ${CORE_LIBRARY_FILES})
set_target_properties(eoengine PROPERTIES BUILD_RPATH "\$ORIGIN" INSTALL_RPATH "\$ORIGIN")

if(ANDROID)
    # JNI binding for libeditors (lib.editors.base.engine.NativeEngine)
    target_sources(eoengine PRIVATE src/jni/DocumentJni.cpp)
    target_link_libraries(eoengine PRIVATE jnigraphics log)
endif()

if(EO_ENGINE_TOOLS)
    add_executable(eo-render tools/render.cpp)
    target_include_directories(eo-render PRIVATE "${CORE_SOURCE_DIR}")
    target_compile_definitions(eo-render PRIVATE LINUX _LINUX)
    target_link_libraries(eo-render PRIVATE eoengine "${CORE_LIBS_PATH}/libgraphics.so" "${CORE_LIBS_PATH}/libkernel.so")
    set_target_properties(eo-render PROPERTIES BUILD_RPATH "\$ORIGIN")
endif()
