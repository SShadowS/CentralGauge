table 70403 "CGR Vehicle Message Seq."
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Vehicle No."; Code[20]) { }
        field(2; "Last Sequence No."; Integer) { }
    }

    keys
    {
        key(PK; "Vehicle No.") { Clustered = true; }
    }
}
