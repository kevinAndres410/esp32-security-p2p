from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor


SOURCE = Path(r"C:\Users\danie\OneDrive\Desktop\TESIS\Word\Monografia.docx")
OUTPUT = Path(__file__).resolve().parent / "output" / "documentos" / "Monografia_completa_complementada.docx"


def remove_paragraph(paragraph):
    element = paragraph._element
    element.getparent().remove(element)


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=100, start=120, bottom=100, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = borders.find(qn(f"w:{edge}"))
        if el is None:
            el = OxmlElement(f"w:{edge}")
            borders.append(el)
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:color"), "D9D9D9")


def format_run(run, size=12, bold=False, color="000000", font="Times New Roman"):
    run.font.name = font
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), font)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), font)
    run.font.size = Pt(size)
    run.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)


def add_paragraph(anchor, text="", style="Normal", kind="body", page_break=False):
    paragraph = anchor.insert_paragraph_before(style=style)
    if page_break:
        paragraph.add_run().add_break(WD_BREAK.PAGE)
    run = paragraph.add_run(text)
    if kind == "h1":
        format_run(run, 14, True, font="Arial")
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(12)
        paragraph.paragraph_format.keep_with_next = True
    elif kind == "h2":
        format_run(run, 13, True, font="Arial")
        paragraph.paragraph_format.space_before = Pt(14)
        paragraph.paragraph_format.space_after = Pt(8)
        paragraph.paragraph_format.keep_with_next = True
    elif kind == "h3":
        format_run(run, 12, True, font="Arial")
        paragraph.paragraph_format.space_before = Pt(10)
        paragraph.paragraph_format.space_after = Pt(6)
        paragraph.paragraph_format.keep_with_next = True
    elif kind == "caption":
        format_run(run, 10, False, font="Arial")
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.space_before = Pt(8)
        paragraph.paragraph_format.space_after = Pt(5)
        paragraph.paragraph_format.keep_with_next = True
    elif kind == "bullet":
        format_run(run, 12)
        paragraph.paragraph_format.left_indent = Cm(0.63)
        paragraph.paragraph_format.first_line_indent = Cm(-0.32)
        paragraph.paragraph_format.space_after = Pt(4)
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    else:
        format_run(run, 12)
        paragraph.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        paragraph.paragraph_format.first_line_indent = Cm(1.0)
        paragraph.paragraph_format.space_after = Pt(6)
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    return paragraph


def add_table(doc, anchor, headers, rows, widths=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    set_repeat_table_header(table.rows[0])
    for col, header in enumerate(headers):
        cell = table.rows[0].cells[col]
        cell.text = header
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_shading(cell, "1F4E78")
        set_cell_margins(cell)
        if widths:
            cell.width = Inches(widths[col])
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        for run in p.runs:
            format_run(run, 9, True, "FFFFFF", "Arial")
    for row_index, values in enumerate(rows):
        cells = table.add_row().cells
        for col, value in enumerate(values):
            cell = cells[col]
            cell.text = str(value)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_margins(cell)
            if widths:
                cell.width = Inches(widths[col])
            if row_index % 2:
                set_cell_shading(cell, "F2F6FA")
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.05
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            for run in p.runs:
                format_run(run, 8.5)
    anchor._p.addprevious(table._tbl)
    return table


def set_core_styles(doc):
    normal = doc.styles["Normal"]
    normal.font.name = "Times New Roman"
    normal._element.rPr.rFonts.set(qn("w:ascii"), "Times New Roman")
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Times New Roman")
    normal.font.size = Pt(12)
    normal.font.color.rgb = RGBColor(0, 0, 0)
    for name, size in (("Heading 1", 14), ("Heading 2", 13), ("Heading 3", 12)):
        style = doc.styles[name]
        style.font.name = "Arial"
        style._element.rPr.rFonts.set(qn("w:ascii"), "Arial")
        style._element.rPr.rFonts.set(qn("w:hAnsi"), "Arial")
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor(0, 0, 0)


def add_framework(doc, anchor):
    add_paragraph(anchor, "Complemento del marco referencial con fuentes verificadas", "Heading 2", "h2")
    add_paragraph(anchor, "Seguridad en dispositivos IoT domésticos", "Heading 3", "h3")
    add_paragraph(anchor, "La seguridad de un producto IoT debe analizarse como un conjunto de capacidades del dispositivo y de los servicios que lo acompañan. NIST IR 8259A organiza una línea base alrededor de la identificación del dispositivo, la configuración autorizada, la protección de datos, la restricción del acceso lógico, la actualización segura y la visibilidad del estado de ciberseguridad (Fagan et al., 2020). La norma ETSI EN 303 645 V3.1.3 aplica este enfoque al IoT de consumo y reconoce que la energía, el ancho de banda, la memoria y la capacidad de procesamiento condicionan las medidas que pueden implementarse (ETSI, 2024).")
    add_paragraph(anchor, "La amenaza no es hipotética. El análisis longitudinal de Mirai documentó un máximo aproximado de 600.000 infecciones y mostró que credenciales débiles y servicios expuestos permitieron comprometer dispositivos embebidos a gran escala (Antonakakis et al., 2017). Para el proyecto, esta evidencia justifica controlar la identidad de cada nodo, evitar secretos comunes por defecto, registrar eventos y limitar la vigencia de las claves.")

    add_paragraph(anchor, "ESP32 y comunicación ESP NOW", "Heading 3", "h3")
    add_paragraph(anchor, "El ESP32 integra conectividad Wi-Fi y Bluetooth, procesadores de hasta 240 MHz, 520 KB de SRAM y aceleradores de hardware para AES, SHA-2 y RSA (Espressif Systems, 2025a). Estas capacidades permiten ejecutar criptografía simétrica y funciones hash, pero obligan a controlar el tamaño de las tramas, los búferes y la persistencia de estado. El prototipo adopta por ello un formato binario fijo y reserva 128 bytes para la carga útil de aplicación.")
    add_paragraph(anchor, "ESP-NOW es un protocolo Wi-Fi sin conexión que transporta datos en tramas de acción específicas del fabricante. La documentación de Espressif indica una tasa predeterminada de 1 Mbps y protección CCMP cuando se configuran claves maestras y claves locales de pares (Espressif Systems, 2025b). En el prototipo, cada nodo mantiene un enlace unicast directo con el gateway. Se trata de enlaces entre pares sobre ESP-NOW coordinados por el gateway, no de una malla completa en la que todos los nodos se comuniquen entre sí.")

    add_paragraph(anchor, "Cifrado autenticado y autenticación de mensajes", "Heading 3", "h3")
    add_paragraph(anchor, "El modo Galois Counter Mode proporciona cifrado autenticado con datos asociados, de modo que una operación protege la confidencialidad de la carga y detecta modificaciones mediante una etiqueta de autenticación (Dworkin, 2007). El protocolo implementado usa AES-256-GCM con un nonce de 96 bits generado para cada trama y autentica como datos asociados los campos de encaminamiento anteriores al nonce. Esta decisión evita que un atacante modifique silenciosamente el tipo de mensaje, la secuencia o el identificador del dispositivo.")
    add_paragraph(anchor, "Además de GCM, la trama incluye HMAC-SHA-256 sobre su representación completa. FIPS 198-1 define HMAC como un mecanismo de autenticación de mensajes construido con una función hash y una clave secreta compartida (NIST, 2008). En el proyecto, HMAC se usa para verificar tramas ESP-NOW, firmar solicitudes del gateway al backend y resolver retos de autenticación de nodos. La comparación de firmas se realiza en tiempo constante en el backend para reducir filtraciones por tiempo de ejecución.")

    add_paragraph(anchor, "Gestión y rotación de claves", "Heading 3", "h3")
    add_paragraph(anchor, "La gestión de claves abarca su generación, distribución, almacenamiento, uso, sustitución y retiro. NIST SP 800-57 define el criptoperiodo como el intervalo durante el cual una clave está autorizada para proteger información y señala que limitarlo reduce la exposición derivada de una eventual filtración (Barker, 2020). La rotación del prototipo materializa ese principio: el backend genera una clave nueva, conserva temporalmente la anterior, distribuye el cambio mediante una orden autenticada y solo elimina la clave previa cuando recibe una confirmación válida con la nueva.")
    add_paragraph(anchor, "NIST SP 800-232 estandariza Ascon para dispositivos restringidos y lo presenta como alternativa cuando AES no ofrece el mejor desempeño (Turan et al., 2025). Esta referencia delimita el uso del término criptografía ligera en la monografía. El prototipo evaluado no implementa Ascon: usa AES-256-GCM mediante las bibliotecas criptográficas de ESP-IDF y aprovecha las capacidades del ESP32. Por tanto, su carácter ligero depende de la integración, del tamaño acotado de las tramas y del costo medido en el dispositivo, no de que AES pertenezca a la familia de algoritmos ligeros de NIST.")

    add_paragraph(anchor, "Control de acceso y seguridad del aplicativo", "Heading 3", "h3")
    add_paragraph(anchor, "El control de acceso basado en roles asigna permisos a funciones organizacionales y después vincula los usuarios con esos roles; el modelo evita administrar cada permiso de forma aislada (Sandhu, Ferraiolo y Kuhn, 2000). El aplicativo define perfiles básico, avanzado y administrador. Las rutas de inventario, eventos y claves exigen un JWT válido, mientras que las operaciones sensibles comprueban el rol vigente en la base de datos.")
    add_paragraph(anchor, "OWASP Top 10 2021 identifica el control de acceso roto, los fallos criptográficos, la inyección, la configuración insegura y los fallos de autenticación entre los principales riesgos de aplicaciones web (OWASP, 2021). La implementación responde parcialmente mediante hash bcrypt para contraseñas, validación de entradas, tokens con expiración, bloqueo después de cinco intentos fallidos, consultas preparadas de SQLite y cabeceras Helmet. El prototipo local transmite el token como Bearer desde localStorage y el servidor de desarrollo opera por HTTP; por ello, HTTPS y el endurecimiento del almacenamiento del token quedan como requisitos de despliegue, no como resultados ya demostrados.")

    add_paragraph(anchor, "Trazabilidad y protección frente a repetición", "Heading 3", "h3")
    add_paragraph(anchor, "La línea base de NIST incluye la capacidad de informar el estado de ciberseguridad del dispositivo (Fagan et al., 2020). El sistema registra conexiones, bloqueos, aprobaciones y rotaciones en SQLite y publica alertas por Socket.IO. Cada trama incorpora una secuencia de 32 bits; el nodo descarta órdenes cuya secuencia no sea mayor que la última aceptada durante el arranque. Este control reduce repeticiones dentro de una sesión, aunque la secuencia aceptada no se persiste en memoria no volátil y, por tanto, la protección entre reinicios requiere fortalecimiento.")

    add_paragraph(anchor, "Relación entre referentes y decisiones de diseño", "Heading 3", "h3")
    add_paragraph(anchor, "Tabla 1. Referentes técnicos aplicados al prototipo", kind="caption")
    add_table(doc, anchor,
              ["Referente", "Hallazgo o requisito", "Aplicación en el proyecto"],
              [
                  ["NIST IR 8259A", "Identificación, protección de datos, acceso lógico y visibilidad del estado", "Identidad por MAC y deviceId, cifrado, roles, bitácora y telemetría"],
                  ["ETSI EN 303 645", "Seguridad proporcional a recursos y ciclo de vida del IoT de consumo", "Tramas acotadas, operación local y registro de eventos"],
                  ["NIST SP 800-38D", "Cifrado autenticado GCM", "AES-256-GCM con nonce de 96 bits y etiqueta de 128 bits"],
                  ["FIPS 198-1", "Autenticación de mensajes con secreto compartido", "HMAC-SHA-256 en tramas, retos y solicitudes del gateway"],
                  ["NIST SP 800-57", "Gestión del ciclo de vida y criptoperiodos", "Rotación manual o periódica, transición con clave anterior y confirmación"],
                  ["OWASP Top 10", "Control de acceso, autenticación, validación y monitoreo", "JWT, RBAC, bcrypt, consultas preparadas, Helmet y eventos"],
              ], widths=[1.45, 2.25, 2.55])
    add_paragraph(anchor, "Fuente. Elaboración propia a partir de las referencias indicadas.", kind="caption")

    add_paragraph(anchor, "Estado del arte", "Heading 2", "h2")
    add_paragraph(anchor, "Las plataformas de automatización residencial como Home Assistant, openHAB, Node-RED y ESPHome priorizan la integración de dispositivos y la automatización. Los servicios administrados, como AWS IoT Core, incorporan infraestructura de identidad y transporte seguro, pero dependen de servicios externos. El aporte del prototipo es más acotado: demostrar en laboratorio la combinación de enlaces ESP-NOW cifrados, rotación de secretos, aprobación de nodos y supervisión local sobre hardware ESP32 de bajo costo.")
    add_paragraph(anchor, "La comparación no permite afirmar que el prototipo sea la única solución con cifrado dinámico o comunicación directa. Su diferencia verificable está en la integración concreta de AES-256-GCM a nivel de aplicación, CCMP en ESP-NOW, HMAC-SHA-256, persistencia NVS, backend local y una interfaz web para gestionar tres nodos y un gateway. Frente a Ascon, el proyecto conserva AES por compatibilidad con ESP-IDF y por su soporte en el hardware utilizado; una evaluación futura debería comparar ambas alternativas bajo la misma carga.")

    add_paragraph(anchor, "Marco legal", "Heading 2", "h2")
    add_paragraph(anchor, "La Ley 1581 de 2012 aplica al tratamiento de datos personales almacenados en bases de datos públicas o privadas y exige principios de finalidad, acceso restringido, seguridad y confidencialidad. En este prototipo, las cuentas, los correos y los eventos se almacenan localmente; por tanto, el responsable de un eventual despliegue debe definir finalidades, autorización, conservación y atención de derechos del titular, además de las salvaguardas técnicas (Congreso de Colombia, 2012).")
    add_paragraph(anchor, "La Ley 1273 de 2009 incorporó al Código Penal colombiano conductas contra la protección de la información y de los datos, entre ellas el acceso abusivo y la interceptación de datos informáticos. Esta norma es pertinente para el modelo de amenazas y para las pruebas: cualquier simulación de ataque debe realizarse únicamente sobre los equipos y redes autorizados del laboratorio (Congreso de Colombia, 2009).")
    add_paragraph(anchor, "El Decreto 1078 de 2015 compila la regulación del sector TIC y contiene lineamientos de confianza y seguridad digital para los sujetos incluidos en su ámbito. En la monografía se usa como contexto sectorial, no como afirmación de certificación del prototipo. Los referentes técnicos NIST, ETSI y OWASP orientan el diseño, pero tampoco constituyen una certificación de cumplimiento.")


def add_methodology(doc, anchor):
    add_paragraph(anchor, "Metodología", "Heading 1", "h1", page_break=True)
    add_paragraph(anchor, "Enfoque y alcance", "Heading 2", "h2")
    add_paragraph(anchor, "El trabajo corresponde a una investigación aplicada de desarrollo tecnológico, con alcance descriptivo y evaluación experimental de un prototipo. La investigación aplicada se expresa en la construcción de un sistema funcional para un problema concreto de seguridad IoT. El componente descriptivo documenta la arquitectura, el protocolo y los controles implementados. El componente experimental observa el comportamiento del sistema bajo condiciones controladas de conexión, distancia, reconexión y operación prolongada.")
    add_paragraph(anchor, "La unidad de análisis fue un kit compuesto por tres nodos ESP32, un gateway ESP32, un backend local y una aplicación web. Las pruebas físicas se realizaron en laboratorio y en una ubicación aproximada de 10 m para uno de los nodos. Los resultados caracterizan este montaje y no se generalizan a redes domésticas de mayor escala, canales radioeléctricos distintos o hardware diferente.")

    add_paragraph(anchor, "Marco de trabajo de desarrollo", "Heading 2", "h2")
    add_paragraph(anchor, "La construcción se organizó de forma iterativa con prácticas de Scrum. La Guía Scrum define ciclos cortos orientados a producir incrementos inspeccionables y adaptar el trabajo a partir de los resultados (Schwaber y Sutherland, 2020). En este proyecto, los autores asumieron las responsabilidades de priorización y desarrollo, mientras el director realizó acompañamiento académico. Debido al tamaño del equipo, los eventos se adaptaron a reuniones de planificación, revisión y retrospectiva; no se afirma una implementación organizacional completa de Scrum.")
    add_paragraph(anchor, "Tabla 2. Organización de los incrementos del proyecto", kind="caption")
    add_table(doc, anchor,
              ["Sprint", "Objetivo", "Incremento verificable"],
              [
                  ["1", "Requisitos y modelo de amenazas", "Backlog, alcance, arquitectura inicial e inventario de riesgos"],
                  ["2", "Protocolo seguro en ESP32", "Trama binaria, AES-256-GCM, HMAC-SHA-256, ESP-NOW y simulador"],
                  ["3", "Servicios de gestión", "Backend Express, SQLite, autenticación, roles, nodos, eventos y rotación"],
                  ["4", "Interfaz e integración física", "Frontend React, gateway, aprovisionamiento por MAC y flujo extremo a extremo"],
                  ["5", "Validación y documentación", "Pruebas automáticas, pruebas físicas, mediciones y registro de limitaciones"],
              ], widths=[0.55, 2.0, 3.7])
    add_paragraph(anchor, "Fuente. Elaboración propia con base en el anteproyecto y los incrementos del repositorio.", kind="caption")

    add_paragraph(anchor, "Fases del procedimiento", "Heading 2", "h2")
    for item in [
        "1. Revisión y definición. Se analizaron guías de seguridad IoT, criptografía autenticada, autenticación de mensajes y gestión de claves; después se delimitaron los requisitos funcionales y no funcionales.",
        "2. Diseño. Se separaron el canal ESP-NOW de nodo a gateway, el canal HTTP del gateway al backend y el canal web en tiempo real. También se definieron el formato de trama, los estados de rotación y el modelo de datos.",
        "3. Implementación. Se construyó el firmware con ESP-IDF, el backend con Node.js y Express, la persistencia con SQLite, la comunicación de interfaz con Socket.IO y el frontend con React.",
        "4. Verificación de software. Se ejecutaron pruebas unitarias y de integración para cifrado, rotación, autenticación, autorización, gestión de nodos y tareas principales de la interfaz.",
        "5. Integración física. Se identificó cada placa por MAC, se grabó el perfil correspondiente y se comprobó el recorrido nodo, gateway, backend y aplicación web.",
        "6. Evaluación experimental. Se midieron RTT extremo a extremo, continuidad de secuencias, presencia simultánea, reconexión, heap y carga estimada de CPU. Se documentaron las condiciones y se excluyeron las ventanas inválidas.",
    ]:
        add_paragraph(anchor, item, "List Paragraph", "bullet")

    add_paragraph(anchor, "Variables e instrumentos", "Heading 2", "h2")
    add_paragraph(anchor, "Tabla 3. Variables y forma de medición", kind="caption")
    add_table(doc, anchor,
              ["Dimensión", "Indicador", "Instrumento o registro"],
              [
                  ["Seguridad funcional", "Aceptación o rechazo de firmas, roles y nodos bloqueados", "Jest, Supertest, Socket.IO client y registros de eventos"],
                  ["Latencia", "RTT medio, percentil 95 y máximo en milisegundos", "Marca temporal en firmware y ACK devuelto después de la sincronización"],
                  ["Confiabilidad", "Huecos de secuencia y presencia en ventana", "Secuencia de protocolo, secuencia de heartbeat y SQLite"],
                  ["Rendimiento", "Paquetes recibidos por segundo y presencia simultánea", "Monitor de rendimiento y archivos JSON"],
                  ["Recursos", "Heap libre, heap mínimo y CPU estimada", "API de heap de ESP-IDF y contadores de FreeRTOS"],
                  ["Usabilidad técnica", "Cumplimiento de siete tareas de interfaz", "React Testing Library; evaluación humana pendiente"],
              ], widths=[1.3, 2.35, 2.6])
    add_paragraph(anchor, "Fuente. Elaboración propia.", kind="caption")

    add_paragraph(anchor, "Diseño de las pruebas", "Heading 2", "h2")
    add_paragraph(anchor, "El escenario base colocó los tres nodos cerca del gateway y configuró un heartbeat nominal cada 10 s. Para evaluar alcance se desplazó el nodo 2 a una distancia aproximada de 10 m. La prueba prolongada duró una hora. La presencia consideró activo un nodo con al menos un heartbeat en los 25 s anteriores, después de 20 s de calentamiento. La pérdida observable se calculó a partir de huecos entre secuencias recibidas dentro del mismo arranque; por ello no cuenta tramas anteriores al primer paquete ni posteriores al último.")
    add_paragraph(anchor, "El RTT comprende el trayecto nodo, ESP-NOW, gateway, solicitud y respuesta del backend y ACK de retorno. No representa latencia unidireccional. La CPU es una estimación derivada de contadores de tareas FreeRTOS y el consumo energético no se midió por falta de un instrumento de corriente. La reconexión controlada se ejecutó una sola vez sobre el nodo 1, por lo que se reporta como observación y no como estimación estadística.")

    add_paragraph(anchor, "Criterios de calidad y tratamiento de datos", "Heading 2", "h2")
    add_paragraph(anchor, "Se usaron identificadores MAC para asociar firmware y placa física, y se verificó el hash después de grabar. Una primera ventana del nodo 2 a 10 m se descartó porque la imagen de aplicación estaba incompleta y el dispositivo no arrancaba. Los archivos de resultados conservan los valores estructurados en JSON y un informe legible en Markdown. Las pruebas humanas de usabilidad y el cuestionario SUS quedaron pendientes; no se generaron datos de participantes ni puntuaciones simuladas.")


def add_development(doc, anchor):
    add_paragraph(anchor, "Desarrollo del proyecto", "Heading 1", "h1", page_break=True)
    add_paragraph(anchor, "Arquitectura implementada", "Heading 2", "h2")
    add_paragraph(anchor, "La solución se implementó en cuatro componentes. Los nodos producen telemetría y reciben órdenes cifradas. El gateway concentra los enlaces ESP-NOW, valida la identidad por MAC y secreto, y sincroniza cada evento con el backend. El backend mantiene usuarios, nodos, kits, claves, eventos y muestras de rendimiento. El frontend permite iniciar sesión, reclamar un kit, aprobar o bloquear dispositivos, consultar alertas y solicitar rotaciones.")
    add_paragraph(anchor, "Tabla 4. Componentes del prototipo", kind="caption")
    add_table(doc, anchor,
              ["Componente", "Tecnología", "Responsabilidad principal"],
              [
                  ["Nodo", "ESP32 y ESP-IDF", "Cifrar telemetría, verificar órdenes, aplicar rotación y reportar recursos"],
                  ["Gateway", "ESP32, ESP-NOW y cliente HTTP", "Autenticar pares, reenviar eventos y distribuir órdenes"],
                  ["Backend", "Node.js, Express, Socket.IO y SQLite", "Autenticación, RBAC, inventario, claves, eventos y persistencia"],
                  ["Frontend", "React", "Gestión de cuentas, nodos, alertas, rotaciones y estado de red"],
                  ["Simulador", "Node.js", "Reproducir el comportamiento criptográfico y validar flujos sin hardware"],
              ], widths=[1.05, 1.85, 3.35])
    add_paragraph(anchor, "Fuente. Elaboración propia a partir del código fuente del proyecto.", kind="caption")

    add_paragraph(anchor, "Protocolo de comunicación segura", "Heading 2", "h2")
    add_paragraph(anchor, "La trama de aplicación ocupa 221 bytes y contiene un valor mágico, versión, tipo, secuencia, deviceId, longitud, nonce de 12 bytes, carga útil de hasta 128 bytes, etiqueta GCM de 16 bytes y HMAC de 32 bytes. Antes del envío, el nodo genera el nonce con el generador aleatorio del ESP32, cifra la carga con AES-256-GCM y calcula HMAC-SHA-256. El receptor verifica primero el HMAC, descifra la carga y finalmente comprueba la secuencia.")
    add_paragraph(anchor, "La protección se aplica en dos capas. ESP-NOW cifra las tramas unicast con CCMP y una LMK por par; el protocolo de aplicación vuelve a proteger la carga con AES-256-GCM. La segunda capa mantiene autenticados los campos lógicos del protocolo y permite que el gateway entregue al backend una identidad de dispositivo verificable mediante HMAC.")

    add_paragraph(anchor, "Rotación y persistencia de claves", "Heading 2", "h2")
    add_paragraph(anchor, "La rotación puede iniciarse desde la interfaz o por el temporizador del backend. El servicio genera un secreto de 32 bytes, mueve la clave vigente al campo temporal clave_anterior y registra el evento. Mientras la transición está abierta, el gateway obtiene la orden al sincronizar con el backend y la envía al nodo cifrada con la clave anterior. El nodo conserva ambas claves durante la validación, persiste la nueva en NVS y responde con un ACK protegido con la clave nueva. El gateway actualiza su NVS al validar el ACK; el backend retira la clave anterior cuando recibe la siguiente sincronización firmada con la nueva.")
    add_paragraph(anchor, "Este diseño evita perder conectividad si la confirmación se retrasa, pero conserva dos riesgos: los secretos iniciales se incorporan a perfiles de firmware y la protección anti-replay no persiste la última secuencia aceptada entre reinicios. Ambos puntos deben tratarse antes de un despliegue fuera del laboratorio.")

    add_paragraph(anchor, "Backend y modelo de datos", "Heading 2", "h2")
    add_paragraph(anchor, "El backend expone rutas para autenticación, kits, nodos, eventos, claves y sincronización del gateway. SQLite almacena usuarios, nodos, eventos, solicitudes de acceso avanzado, muestras de rendimiento, kits y solicitudes de dispositivos. Las consultas con parámetros reducen el riesgo de inyección. Socket.IO publica cambios de estado y alertas sin recargar la interfaz.")
    add_paragraph(anchor, "Las contraseñas se validan con una longitud mínima de 12 caracteres y diversidad de tipos, y se almacenan con bcrypt. El inicio de sesión entrega un JWT válido por ocho horas. Después de cinco intentos fallidos la cuenta queda bloqueada. Las rutas protegidas exigen un token Bearer y las operaciones avanzadas consultan el rol actual en la base de datos. En la versión evaluada, el token se guarda en localStorage y el servidor se ejecuta por HTTP local; el despliegue requiere TLS, secretos de entorno no predeterminados y una estrategia de sesión más resistente a XSS.")

    add_paragraph(anchor, "Aprovisionamiento e identidad física", "Heading 2", "h2")
    add_paragraph(anchor, "El sistema identifica las placas por MAC y no por el puerto COM, que puede cambiar entre conexiones. El inventario asocia gateway, nodos y secretos de fábrica a un kit. El script de grabación lee la MAC, selecciona el perfil permitido y rechaza una combinación incompatible antes de escribir el firmware. Después del reclamo del kit, un dispositivo detectado puede quedar pendiente de aprobación hasta que un usuario autorizado lo admita.")

    add_paragraph(anchor, "Interfaz web", "Heading 2", "h2")
    add_paragraph(anchor, "La interfaz React separa las funciones básicas de las avanzadas. El usuario puede registrarse, iniciar sesión, observar el estado de los dispositivos y cerrar sesión. Los perfiles avanzados acceden al inventario, al bloqueo de nodos, a los eventos y a la rotación de claves. El frontend presenta confirmaciones para operaciones sensibles y mensajes de estado para que el usuario identifique el resultado de cada acción.")

    add_paragraph(anchor, "Integración y resultados de verificación", "Heading 2", "h2")
    add_paragraph(anchor, "La integración física verificó el recorrido heartbeat cifrado, gateway, POST de sincronización, persistencia y actualización del estado web. También se comprobó una rotación real y su permanencia después de reiniciar nodo y gateway. Las suites registradas el 16 de septiembre de 2026 aprobaron 41 pruebas del backend, 8 del frontend y 13 del simulador.")
    add_paragraph(anchor, "Tabla 5. Resultados principales del prototipo", kind="caption")
    add_table(doc, anchor,
              ["Prueba", "Resultado", "Interpretación"],
              [
                  ["Tres nodos cercanos durante 3 min", "54 heartbeats, 18 por nodo; presencia simultánea 100 %", "La cadena física operó de forma continua bajo carga nominal"],
                  ["Nodo 2 a aproximadamente 10 m durante 3 min", "5 huecos de 18 intentos inferidos; 27,78 % observable", "Hubo comunicación, pero perdió continuidad"],
                  ["Registro de una hora", "806 heartbeats; presencia simultánea 31,23 %", "Los nodos 1 y 3 fueron regulares; el nodo 2 dejó de reportar al final"],
                  ["Reconexión controlada del nodo 1", "3,766 s desde liberar reset hasta el primer heartbeat", "Observación de una repetición, sin dispersión estadística"],
                  ["Recursos durante una hora", "Heap libre mínimo 217.440 B; CPU media estimada entre 0,05 % y 0,06 %", "No se observó agotamiento de memoria bajo la carga nominal"],
              ], widths=[1.8, 2.15, 2.3])
    add_paragraph(anchor, "Fuente. Informe consolidado de pruebas del proyecto, corte del 16 de septiembre de 2026.", kind="caption")
    add_paragraph(anchor, "Los RTT medios de la prueba de una hora fueron 281,29 ms para el nodo 1, 348,87 ms para el nodo 2 y 298,45 ms para el nodo 3. El nodo 2 recibió 77 heartbeats y permaneció sin reportar durante los últimos 30 min 58,689 s. Estos datos no permiten atribuir la falla únicamente a la distancia, porque no se controlaron RSSI, obstáculos ni interferencia. Tampoco representan la capacidad máxima del canal: la carga consistió en un heartbeat nominal cada 10 s por nodo.")

    add_paragraph(anchor, "Limitaciones del desarrollo", "Heading 2", "h2")
    for item in [
        "La topología física validada es de enlaces unicast nodo-gateway; no se probó una malla completa entre todos los nodos.",
        "La protección anti-replay mantiene la última secuencia solo durante el arranque actual.",
        "No se midieron corriente, potencia ni energía por falta de un instrumento externo.",
        "La reconexión controlada se repitió una sola vez y la distancia de 10 m fue aproximada.",
        "La evaluación de usabilidad con participantes y el cálculo de SUS continúan pendientes.",
        "La configuración de laboratorio usa HTTP local y claves de desarrollo; un despliegue requiere TLS, gestión externa de secretos, actualización segura de firmware y endurecimiento del dispositivo.",
    ]:
        add_paragraph(anchor, item, "List Paragraph", "bullet")


def add_references(anchor):
    references = [
        "Antonakakis, M., et al. (2017). Understanding the Mirai Botnet. 26th USENIX Security Symposium, 1093-1110. https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/antonakakis",
        "Barker, E. (2020). Recommendation for Key Management Part 1 General. NIST SP 800-57 Part 1 Rev. 5. https://doi.org/10.6028/NIST.SP.800-57pt1r5",
        "Congreso de Colombia. (2009). Ley 1273 de 2009. https://suin-juriscol.gov.co/viewDocument.asp?id=1676699",
        "Congreso de Colombia. (2012). Ley 1581 de 2012. https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981",
        "Dworkin, M. (2007). Recommendation for Block Cipher Modes of Operation Galois Counter Mode GCM and GMAC. NIST SP 800-38D. https://doi.org/10.6028/NIST.SP.800-38D",
        "Espressif Systems. (2025a). ESP32 Series Datasheet Version 5.3. https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf",
        "Espressif Systems. (2025b). ESP-NOW ESP-IDF Programming Guide. https://docs.espressif.com/projects/esp-idf/en/v5.2/esp32/api-reference/network/esp_now.html",
        "ETSI. (2024). ETSI EN 303 645 V3.1.3 Cyber Security for Consumer Internet of Things Baseline Requirements. https://www.etsi.org/deliver/etsi_en/303600_303699/303645/03.01.03_60/en_303645v030103p.pdf",
        "Fagan, M., Megas, K., Scarfone, K., y Smith, M. (2020). IoT Device Cybersecurity Capability Core Baseline. NIST IR 8259A. https://doi.org/10.6028/NIST.IR.8259A",
        "NIST. (2008). The Keyed-Hash Message Authentication Code HMAC. FIPS 198-1. https://doi.org/10.6028/NIST.FIPS.198-1",
        "OWASP. (2018). OWASP Internet of Things Top 10. https://wiki.owasp.org/images/1/1c/OWASP-IoT-Top-10-2018-final.pdf",
        "OWASP. (2021). OWASP Top 10 2021. https://top10.owasp.org/2021/",
        "Sandhu, R., Ferraiolo, D., y Kuhn, D. R. (2000). The NIST Model for Role-Based Access Control Towards a Unified Standard. Proceedings of the Fifth ACM Workshop on Role-Based Access Control. https://doi.org/10.1145/344287.344301",
        "Schwaber, K., y Sutherland, J. (2020). The Scrum Guide. https://scrumguides.org/scrum-guide.html",
        "Turan, M. S., McKay, K., Kang, J., Kelsey, J., y Chang, D. (2025). Ascon-Based Lightweight Cryptography Standards for Constrained Devices. NIST SP 800-232. https://doi.org/10.6028/NIST.SP.800-232",
    ]
    add_paragraph(anchor, "Referencias incorporadas para el marco, la metodología y el desarrollo", "Heading 2", "h2")
    for ref in references:
        p = add_paragraph(anchor, ref, "List Paragraph", "body")
        p.paragraph_format.first_line_indent = Cm(-1.0)
        p.paragraph_format.left_indent = Cm(1.0)
        p.paragraph_format.space_after = Pt(6)


def main():
    doc = Document(SOURCE)
    set_core_styles(doc)
    paragraphs = list(doc.paragraphs)

    framework_anchor = paragraphs[380]
    add_framework(doc, framework_anchor)
    for p in paragraphs[381:391]:
        remove_paragraph(p)

    development_anchor = paragraphs[408]
    for p in paragraphs[391:408]:
        remove_paragraph(p)
    add_methodology(doc, development_anchor)
    add_development(doc, development_anchor)

    reference_anchor = doc.add_paragraph("")
    add_references(reference_anchor)
    remove_paragraph(reference_anchor)

    # Ask Word-compatible applications to refresh fields such as the TOC on open.
    settings = doc.settings._element
    update_fields = settings.find(qn("w:updateFields"))
    if update_fields is None:
        update_fields = OxmlElement("w:updateFields")
        settings.append(update_fields)
    update_fields.set(qn("w:val"), "true")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
