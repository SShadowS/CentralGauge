table 71431 "CG X159 Email Registry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; Email; Text[80]) { }
        field(2; "Contact No."; Code[20]) { }
    }

    keys
    {
        key(PK; Email)
        {
            Clustered = true;
        }
    }
}
