table 70277"CGR Web Booking Error"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Booking Text"; Text[2048]) { }
        field(3; "Error Text"; Text[250]) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
