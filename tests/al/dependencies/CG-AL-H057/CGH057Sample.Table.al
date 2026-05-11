table 69570 "CG H057 Sample"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; "Description"; Text[100]) { }
        field(3; "Touch Count"; Integer) { InitValue = 0; }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }

    trigger OnModify()
    begin
        // Detect external Modify calls. A Modify whose only change is
        // "Touch Count" itself is the self-bump below; skip to avoid recursion.
        if (Rec."Code" = xRec."Code") and
           (Rec."Description" = xRec."Description") and
           (Rec."Touch Count" <> xRec."Touch Count")
        then
            exit;
        Rec."Touch Count" := xRec."Touch Count" + 1;
    end;
}
