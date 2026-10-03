cmake_minimum_required(VERSION 3.20)
project(mydb LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(MYDB_V8_ROOT "" CACHE PATH "V8 checkout or installation root")
option(MYDB_V8_POINTER_COMPRESSION "Match a V8 build with pointer compression" ON)
option(MYDB_V8_31BIT_SMIS "Match a V8 build with 31-bit Smis" ON)

if(NOT MYDB_V8_ROOT)
    message(FATAL_ERROR "Set MYDB_V8_ROOT to a V8 installation containing include and lib")
endif()

add_executable(mydb
    runtime/main.cpp
    runtime/v8_runtime.cpp
    runtime/module_loader.cpp
    runtime/bindings/fs.cpp
    runtime/bindings/memory.cpp
    runtime/bindings/net.cpp
    runtime/bindings/runtime.cpp
    runtime/bindings/time.cpp
    runtime/bindings/process.cpp
    runtime/bindings/logging.cpp
    runtime/bindings/debug.cpp
)

target_include_directories(mydb PRIVATE runtime/include "${MYDB_V8_ROOT}/include")
if(MYDB_V8_POINTER_COMPRESSION)
    target_compile_definitions(mydb PRIVATE V8_COMPRESS_POINTERS)
endif()
if(MYDB_V8_31BIT_SMIS)
    target_compile_definitions(mydb PRIVATE V8_31BIT_SMIS_ON_64BIT_ARCH)
endif()
find_library(MYDB_V8_MONOLITH v8_monolith PATHS "${MYDB_V8_ROOT}/lib" NO_DEFAULT_PATH)
if(MYDB_V8_MONOLITH)
    target_link_libraries(mydb PRIVATE "${MYDB_V8_MONOLITH}")
else()
    find_library(MYDB_V8 v8 REQUIRED PATHS "${MYDB_V8_ROOT}/lib" NO_DEFAULT_PATH)
    find_library(MYDB_V8_PLATFORM v8_libplatform REQUIRED PATHS "${MYDB_V8_ROOT}/lib" NO_DEFAULT_PATH)
    find_library(MYDB_V8_BASE v8_libbase REQUIRED PATHS "${MYDB_V8_ROOT}/lib" NO_DEFAULT_PATH)
    target_link_libraries(mydb PRIVATE "${MYDB_V8}" "${MYDB_V8_PLATFORM}" "${MYDB_V8_BASE}")
endif()
find_package(Threads REQUIRED)
target_link_libraries(mydb PRIVATE Threads::Threads "${CMAKE_DL_LIBS}")
if(WIN32)
    target_link_libraries(mydb PRIVATE ws2_32)
endif()
target_compile_definitions(mydb PRIVATE MYDB_JS_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/js")
file(GLOB_RECURSE MYDB_JS_FILES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/js/*.js")
add_custom_target(mydb_js ALL
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/js" "$<TARGET_FILE_DIR:mydb>/js"
    DEPENDS ${MYDB_JS_FILES}
)
add_dependencies(mydb mydb_js)
