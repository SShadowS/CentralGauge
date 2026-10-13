table 70513 "CGR Utilisation Buffer"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Vehicle No."; Code[20]) { }
        field(2; Rentals; Integer) { }
        field(3; Revenue; Decimal) { }
    }

    keys
    {
        key(PK; "Vehicle No.") { Clustered = true; }
    }
}
