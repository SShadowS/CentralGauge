table 70553 "CGR Owner Ledger File"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(3; Content; Blob) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
