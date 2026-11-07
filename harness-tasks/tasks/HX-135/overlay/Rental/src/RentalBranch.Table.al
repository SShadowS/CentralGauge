table 70240 "CGR Rental Branch"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[10]) { }
        field(2; Name; Text[100]) { }
        field(3; "Day Closing Running"; Boolean) { }
        field(4; "Last Closed Date"; Date) { }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }
}
