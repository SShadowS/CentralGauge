table 70126 "CGR Fleet Audit Finding"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Vehicle No."; Code[20]) { }
        field(2; "Line No."; Integer) { }
        field(3; "Audit Date"; Date) { }
        field(4; Finding; Text[250]) { }
        field(5; "Check Failed"; Boolean) { }
    }

    keys
    {
        key(PK; "Vehicle No.", "Line No.") { Clustered = true; }
    }
}
