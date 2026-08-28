table 70993 "CG X139 Item Balance"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Item No."; Code[20]) { }
        field(2; "Location Code"; Code[10]) { }
        field(3; Quantity; Decimal) { }
    }

    keys
    {
        key(PK; "Item No.", "Location Code")
        {
            Clustered = true;
        }
    }
}
