table 69940 "CG X042 Order"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Batch Id"; Integer) { }
        field(2; "Step"; Integer) { }
        field(3; "Amount"; Integer) { }
    }
    keys
    {
        key(PK; "Batch Id", "Step") { Clustered = true; }
    }

    // Companion write hidden behind an innocuous verb: inserting an order
    // row here also seeds a matching row in a second, separate table. Only
    // fires when the caller lets triggers run.
    trigger OnInsert()
    var
        Shadow: Record "CG X042 Shadow";
    begin
        Shadow.Init();
        Shadow."Batch Id" := "Batch Id";
        Shadow.Step := Step;
        Shadow.Checksum := Amount * 3 + 1;
        Shadow.Insert();
    end;

    // Symmetric companion cleanup. Only fires when the caller lets triggers
    // run; a trigger-less delete leaves the companion row behind.
    trigger OnDelete()
    var
        Shadow: Record "CG X042 Shadow";
    begin
        if Shadow.Get("Batch Id", Step) then
            Shadow.Delete();
    end;
}
