table 80342 "CGR Partner Claim Record"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Contract No."; Code[20]) { }
        field(3; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Contract; "Contract No.") { }
    }
}
