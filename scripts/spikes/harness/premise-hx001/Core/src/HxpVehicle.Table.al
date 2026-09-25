// SPIKE (throwaway): harness bench M4-00 premise probe
table 50100 "HXP Vehicle"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Mileage; Integer) { }
        field(3; "Checked Out"; Boolean) { }
        field(4; Blocked; Boolean) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
