table 69991 "CG X050 Entry"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Entry No."; Integer) { }
        field(10; "Batch Id"; Integer) { }
        field(20; Kind; Enum "CG X050 Entry Kind") { }
        field(30; Amount; Integer) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(ByAmount; Amount) { }
    }
}
