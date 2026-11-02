table 70431 "CGR Invoice Mail Log"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Contract No."; Code[20]) { }
        field(3; "Sent At"; DateTime) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Contract; "Contract No.") { }
    }
}
