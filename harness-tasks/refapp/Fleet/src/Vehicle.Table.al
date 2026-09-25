table 70100 "CGR Vehicle"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Mileage; Integer) { }
        field(3; "Checked Out"; Boolean) { }
        field(4; Strategy; Enum "CGR Maintenance Strategy") { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
