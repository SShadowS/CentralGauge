pageextension 50710 "Sample Bus. Mgr. RC Ext" extends "Business Manager Role Center"
{
    layout
    {
        addafter(Control16)
        {
            part(SampleMyCustomers; "My Customers")
            {
                ApplicationArea = Basic, Suite;
                // Declarative permission gating: the part is removed for users
                // without Read permission on Customer.
                AccessByPermission = TableData Customer = R;
            }
        }
    }
}
