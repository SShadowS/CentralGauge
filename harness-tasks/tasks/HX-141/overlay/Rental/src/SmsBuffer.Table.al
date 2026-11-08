table 70285 "CGR SMS Buffer"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Contract No."; Code[20]) { }
        field(3; "Message Text"; Text[160]) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
