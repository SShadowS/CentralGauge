enumextension 70459 "CG-AL-X080 Late Carrier Status" extends "CG X080 Carrier Status"
{
    // Oracle-side only: never rendered into the starter prompt. Represents a
    // status the carrier introduces AFTER this application shipped, so a fix
    // that only special-cases the value the starter/correct app already
    // declares (ordinal 40) still has to resolve this one correctly with no
    // code change at all.
    value(50; "Held At Customs")
    {
        Caption = 'Held at customs';
    }
}
