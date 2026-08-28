# Registra los fuentes de este componente ("main").
# cipher.c se compila como C puro; esp32_node.cpp como C++ (Arduino).
idf_component_register(
    SRCS "esp32_node.cpp" "cipher.c"
    INCLUDE_DIRS "."
)
