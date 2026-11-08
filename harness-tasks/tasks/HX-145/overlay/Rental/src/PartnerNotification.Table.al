table 70295 "CGR Partner Notification"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Event Type"; Text[30]) { }
        field(3; Payload; Code[20]) { }
        field(4; "Created At"; DateTime) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
