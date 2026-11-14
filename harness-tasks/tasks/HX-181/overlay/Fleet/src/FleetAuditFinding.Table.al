table 70126 "CGR Fleet Audit Finding"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Damage Entry No."; Integer) { }
        field(2; "Vehicle No."; Code[20]) { }
        field(3; "Reported On"; Date) { }
        field(4; Description; Text[100]) { }
        field(5; "Audit Date"; Date) { }
    }

    keys
    {
        key(PK; "Damage Entry No.") { Clustered = true; }
        key(Vehicle; "Vehicle No.") { }
    }
}
