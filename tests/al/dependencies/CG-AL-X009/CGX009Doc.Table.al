table 69690 "CG X009 Doc"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; "Base"; Integer) { }
        field(3; "Computed"; Integer) { }
    }
    keys { key(PK; "Code") { Clustered = true; } }

    trigger OnInsert()
    begin
        // Opaque routing formula: intentionally not a simple copy of "Base"
        // so a caller cannot pass this test by guessing/duplicating the
        // value itself. It must come from this trigger actually running.
        "Computed" := "Base" * 7 + 3;
    end;
}
