table 71330 "CG X149 Allocation Header"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Document No."; Code[20]) { }
        field(2; "Department Code"; Code[10]) { }
    }

    keys
    {
        key(PK; "Document No.")
        {
            Clustered = true;
        }
    }
}
