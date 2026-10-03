#include "runtime.h"

#include <exception>
#include <filesystem>
#include <iostream>

int main(int argc, char** argv) {
    try {
        std::vector<std::string> arguments(argv, argv + argc);
        auto bundled = std::filesystem::absolute(argv[0]).parent_path() / "js";
        auto js_root = std::filesystem::exists(bundled / "bootstrap.js") ? bundled.string() : MYDB_JS_ROOT;
        mydb::Runtime runtime(argv[0], std::move(js_root), std::move(arguments));
        return runtime.run("bootstrap.js");
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
