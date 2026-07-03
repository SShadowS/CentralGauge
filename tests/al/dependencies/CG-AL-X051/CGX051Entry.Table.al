table 69997 "CG X051 Entry"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Entry No."; Integer) { }
        field(10; "Account No."; Code[20]) { }
        field(20; Kind; Enum "CG X051 Kind") { }
        field(30; Amount; Integer) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
