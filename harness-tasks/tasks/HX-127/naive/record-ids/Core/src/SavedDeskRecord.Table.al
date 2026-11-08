table 70044 "CGR Saved Desk Record"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Selection Code"; Code[20]) { }
        field(2; "Line No."; Integer) { }
        field(3; "Saved Record Id"; RecordId) { }
    }

    keys
    {
        key(PK; "Selection Code", "Line No.") { Clustered = true; }
    }
}
