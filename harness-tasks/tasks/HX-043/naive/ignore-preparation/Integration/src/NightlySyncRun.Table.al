table 70413 "CGR Nightly Sync Run"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Run No."; Integer) { AutoIncrement = true; }
        field(2; "Started At"; DateTime) { }
        field(3; Dispatched; Integer) { }
        field(4; Completed; Boolean) { }
    }

    keys
    {
        key(PK; "Run No.") { Clustered = true; }
    }
}
